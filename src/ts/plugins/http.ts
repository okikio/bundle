/** Based on https://github.com/hardfist/neo-tools/blob/main/packages/bundler/src/plugins/http.ts */
import type { OnLoadArgs, OnResolveArgs, OnResolveResult, OutputFile, Plugin } from 'esbuild';
import { FileSystem, getResolvedPath, setFile } from '../util/filesystem';

import { getRequest } from '../util/fetch-and-cache';
import { decode } from '../util/encode-decode';

import { getCDNUrl, DEFAULT_CDN_HOST, getCDNStyle, getPureImportPath } from '../util/util-cdn';
import { inferLoader } from '../util/loader';

import { urlJoin, extname, isBareImport, isAbsolute } from "../util/path";
import { CDN_RESOLVE } from './cdn';

/** HTTP Plugin Namespace */
export const HTTP_NAMESPACE = 'http-url';

/**
 * Fetches packages
 * 
 * @param url package url to fetch
 * @param logger Console log
 */
export async function fetchPkg(url: string, logger = console.log, fetchOpts?: RequestInit) {
    try {
        const response = await getRequest(url, undefined, fetchOpts);
        if (!response.ok)
            throw new Error(`Couldn't load ${response.url || url} (${response.status} code)`);

        if (/text\/html/.test(response.headers.get("content-type")))
            throw new Error("Can't load HTML as a package");

        logger(`Fetch ${fetchOpts?.method === "HEAD" ? `(test)` : ""} ${response.url || url}`, "info");

        return {
            // Deno doesn't have a `response.url` which is odd but whatever
            url: response.url || url,
            contentType: response.headers.get("content-type"),
            content: new Uint8Array(await response.arrayBuffer()),
        };
    } catch (err) {
        throw new Error(`[getRequest] Failed at request (${url})\n${err.toString()}`);
    }
}

/**
 * Fetches assets from a js file, e.g. assets like WASM, Workers, etc... 
 * External assets are referenced using this syntax, e.g. new URL("...", import.meta.url)
 * Any external assets found inside said original js file, are fetched and stored
 * 
 * @param path Path for original js files 
 * @param content Content of original js files
 * @param namespace esbuild plugin namespace
 * @param logger Console log
 */
export const fetchAssets = async (path: string, content: Uint8Array, namespace: string, logger = console.log) => {
    // Regex for `new URL("./path.js", import.meta.url)`, 
    // I added support for comments so you can add comments and the regex
    // will ignore the comments
    const rgx = /new URL\((?:\s*(?:\/\*(?:.*\n)*\*\/)?(?:\/\/.*\n)?)*(?:(?!\`.*\$\{)['"`](.*)['"`]),(?:\s*(?:\/\*(?:.*\n)*\*\/)?(?:\/\/.*\n)?)*import\.meta\.url(?:\s*(?:\/\*(?:.*\n)*\*\/)?(?:\/\/.*\n)?)*\)/g;
    const parentURL = new URL("./", path).toString();

    const code = decode(content);
    const matches = Array.from(code.matchAll(rgx)) as RegExpMatchArray[]; 

    const promises = matches.map(async ([, assetURL]) => {
        let { content: asset, url } = await fetchPkg(urlJoin(parentURL, assetURL), logger);
        
        // Create a virtual file system for storing assets
        // This is for building a package bundle analyzer 
        setFile(namespace + ":" + url, content);
        // let { pathname } = new URL(getPureImportPath(url), "https://local.com");
        // setFile("/node_modules" + pathname, content);

        return {
            path: assetURL, contents: asset,
            get text() { return decode(asset); }
        };
    });

    return await Promise.allSettled(promises); 
};

// Imports have various extentions, fetch each extention to confirm what the user meant
const fileEndings = ["", "/index"];
const exts = ["", ".js", ".mjs", "/index.js", ".ts", ".tsx", ".cjs", ".d.ts"];

// It's possible to have `./lib/index.d.ts` or `./lib/index.mjs`, and have a user enter use `./lib` as the import
// It's very annoying but you have to check all variants
const allEndingVariants = Array.from(new Set(fileEndings.map(ending => {
    return exts.map(extension => ending + extension)
}).flat()));

const endingVariantsLength = allEndingVariants.length;
const FAILED_EXT_URLS = new Set<string>();

/**
 * Test the waters, what extension are we talking about here
 * @param path 
 * @returns 
 */
export async function determineExtension(path: string, headersOnly: true | false = true, logger = console.log) {
    // Some typescript files don't have file extensions but you can't fetch a file without their file extension
    // so bundle tries to solve for that
    const argPath = (suffix = "") => path + suffix;
    let url = path;
    let content: Uint8Array | undefined;
    let contentType: string | null = null;

    let err: Error | undefined;
    for (let i = 0; i < endingVariantsLength; i++) {
        const endings = allEndingVariants[i];
        const testingUrl = argPath(endings);

        try {
            if (FAILED_EXT_URLS.has(testingUrl)) {
                continue;
            }

            ({ url, contentType, content } = await fetchPkg(testingUrl, logger, headersOnly ? { method: "HEAD" } : undefined));
            break;
        } catch (e) {
            FAILED_EXT_URLS.add(testingUrl);

            if (i === 0) {
                err = e as Error;
            }

            // If after checking all the different file extensions none of them are valid
            // Throw the first fetch error encountered, as that is generally the most accurate error
            if (i >= endingVariantsLength - 1) {
                logger((err ?? e).toString(), "error");
                throw err ?? e;
            }
        }
    }

    return headersOnly ? { url, contentType } : { url, content, contentType };
}

/**
 * Resolution algorithm for the esbuild HTTP plugin
 * 
 * @param host The default host origin to use if an import doesn't already have one
 * @param logger Console log
 */
export const HTTP_RESOLVE = (host = DEFAULT_CDN_HOST, logger = console.log) => {
    return async (args: OnResolveArgs): Promise<OnResolveResult> => {
        // Some packages use "../../" with the assumption that "/" is equal to "/index.js", this is supposed to fix that bug
        const argPath = args.path; //.replace(/\/$/, "/index");

        // If the import path isn't relative do this...
        if (!argPath.startsWith(".") && !isAbsolute(argPath)) {
            // If the import is an http import load the content via the http plugins loader
            if (/^https?:\/\//.test(argPath)) {
                return {
                    path: argPath,
                    namespace: HTTP_NAMESPACE,
                    sideEffects: typeof args.pluginData?.pkg?.sideEffects === "boolean" ? args.pluginData?.pkg?.sideEffects : undefined,
                    pluginData: { pkg: args.pluginData?.pkg },
                };
            }

            const pathOrigin = new URL(
                // Use the parent files URL as a host
                urlJoin(args.pluginData?.url ? args.pluginData?.url : host, "../", argPath)
            ).origin;

            // npm standard CDNs, e.g. unpkg, skypack, esm.sh, etc...
            const NPM_CDN = getCDNStyle(pathOrigin) == "npm";
            const origin = NPM_CDN ? pathOrigin : host;

            // If the import is a bare import, use the CDN plugins resolution algorithm
            if (isBareImport(argPath)) {
                return await CDN_RESOLVE(origin, logger)(args);
            } else {
                /** 
                 * If the import is neither an http import or a bare import (module import), then it is an absolute import.
                 * Therefore, load the content via the http plugins loader, but make sure that the absolute URL doesn't go past the root URL
                 * 
                 * e.g. 
                 * To load `jquery` from jsdelivr, the CDN root needs to `https://cdn.jsdelivr.net/npm`, 
                 * thus the final URL is https://cdn.jsdelivr.net/npm/jquery
                 * 
                 * The problem is that if a user using absolute URL's aims for the root domain, 
                 * the result should be `https://cdn.jsdelivr.net`, but what we really want is for our use case is
                 * a root of `https://cdn.jsdelivr.net/npm`
                 * 
                 * So, we treat the path as a CDN and force all URLs to use CDN origins as the root domain
                */
                return {
                    path: getCDNUrl(argPath, origin).url.toString(),
                    namespace: HTTP_NAMESPACE,
                    sideEffects: typeof args.pluginData?.pkg?.sideEffects === "boolean" ? args.pluginData?.pkg?.sideEffects : undefined,
                    pluginData: { pkg: args.pluginData?.pkg },
                };
            }
        }

        // For relative imports
        let path = urlJoin(args.pluginData?.url, "../", argPath);
        if (isAbsolute(argPath)) { 
            const _url = new URL(args.pluginData?.url);
            _url.pathname = argPath;
            path = _url.toString();
        }

        return {
            path,
            namespace: HTTP_NAMESPACE,
            sideEffects: typeof args.pluginData?.pkg?.sideEffects === "boolean" ? args.pluginData?.pkg?.sideEffects : undefined,
            pluginData: { pkg: args.pluginData?.pkg },
        };
    };
};

/**
 * Esbuild HTTP plugin 
 * 
 * @param assets Array to store fetched assets
 * @param host The default host origin to use if an import doesn't already have one
 * @param logger Console log
 */
export const HTTP = (assets: OutputFile[] = [], host = DEFAULT_CDN_HOST, logger = console.log): Plugin => {
    return {
        name: HTTP_NAMESPACE,
        setup(build) {
            // Intercept import paths starting with "http:" and "https:" so
            // esbuild doesn't attempt to map them to a file system location.
            // Tag them with the "http-url" namespace to associate them with
            // this plugin.
            build.onResolve({ filter: /^https?:\/\// }, args => {
                return {
                    path: args.path,
                    namespace: HTTP_NAMESPACE,
                };
            });

            // We also want to intercept all import paths inside downloaded
            // files and resolve them against the original URL. All of these
            // files will be in the "http-url" namespace. Make sure to keep
            // the newly resolved URL in the "http-url" namespace so imports
            // inside it will also be resolved as URLs recursively.
            build.onResolve({ filter: /.*/, namespace: HTTP_NAMESPACE }, HTTP_RESOLVE(host, logger));

            // When a URL is loaded, we want to actually download the content
            // from the internet. This has just enough logic to be able to
            // handle the example import from https://cdn.esm.sh/ but in reality this
            // would probably need to be more complex.
            build.onLoad({ filter: /.*/, namespace: HTTP_NAMESPACE }, async (args) => {
                // Some typescript files don't have file extensions but you can't fetch a file without their file extension
                // so bundle tries to solve for that

                // Some typescript files don't have file extensions but you can't fetch a file without their file extension
                // so bundle tries to solve for that
                let content: Uint8Array | undefined, url: string;
                let contentType: string | null = null;
                ({ content, contentType, url } = await determineExtension(args.path, false, logger));

                // Create a virtual file system for storing node modules
                // This is for building a package bundle analyzer 
                // await FileSystem.set(args.namespace + ":" + args.path, content);

                if (content) {
                    // Create a virtual file system for storing node modules
                    // This is for building a package bundle analyzer 
                    setFile(args.namespace + ":" + args.path, content);

                    const _assetResults =
                        (await fetchAssets(url, content, args.namespace, logger))
                            .filter((result) => {
                                if (result.status == "rejected") {
                                    logger("Asset fetch failed.\n" + result?.reason?.toString(), "warning");
                                    return false;
                                } else return true;
                            })
                            .map((result) => {
                                if (result.status == "fulfilled")
                                    return result.value;
                            }) as OutputFile[];

                    assets = assets.concat(_assetResults); 
                    return {
                        contents: content,
                        loader: inferLoader(url, contentType),
                        pluginData: { url, pkg: args.pluginData?.pkg },
                    };
                }
            });
        },
    };
};