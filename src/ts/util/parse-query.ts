import { decompressFromURL } from "@amoutonbrady/lz-string";
import { EasyDefaultConfig } from "../configs/bundle-options";
import { basename, extname } from "../deno/path/mod.ts";
import { deepAssign } from "./deep-equal";
import { parse as parsePackageName } from "parse-package-name";

export const parseInput = (value: string) => {
    const host = "https://registry.npmjs.com/-/v1/search?text";
    // const host = "https://api.npms.io/v2/search?q";
    let urlScheme = `${host}=${encodeURIComponent(
        value
    )}&popularity=0.5&size=30`;

    let version = "";
    let exec = /([\S]+)@([\S]+)/g.exec(value);
    if (exec) {
        let [, pkg, ver] = exec;
        version = ver;
        urlScheme = `${host}=${encodeURIComponent(
            pkg
        )}&popularity=0.5&size=30`;
    }

    return { url: urlScheme, version };
};

/**
 * Treeshake exports/imports. It allows for specifing multiple exports per package, through this syntax
 * ```ts
 * "[{ x,y,z }],[*],[* as X],[{ type xyz }]" 
 * // to
 * export { x, y, z } from "...";
 * export * from "...";
 * export * as X from "...";
 * export { type xyz } from "...";
 * ```
 * where the square brackets represent seperate packages, and everything inside the squarebrackets,
 * are the exported methods, types, etc...
 */
export const parseTreeshakeExports = (str: string) =>
    (str ?? "").split(/\],/).map((str) => str.replace(/\[|\]/g, ""));

/**
 * Grab the basename w/o an extension
 */
export const fromBasename = (path: string) =>
    basename(path.replace(/^https?\:\/\//, ""), extname(path));
    
/**
 * Get cleaned up module name
 * e.g. "@okikio/animate" -> okikioAnimate
 */
export const getModuleName = (str: string) => {
    let name = str; 
    let path = null;
    try {
        ({ name, path } = parsePackageName(str));
    } catch (e) {}

    let _str = str;
    if (/^https?\:\/\//.test(str)) {
        _str = fromBasename(str);
    } else if (name.length > 0) {
        _str = name + (path ? fromBasename(path) : "");
    }
    
    let result = _str.split(/(?:-|_|\/)/g)
        .map((x: string | any[], i: number) => i > 0 && x.length > 0 ? (x[0].toUpperCase() + x.slice(1)) : x)
        .join("")
        .replace(/[^\w\s]/gi, "");

    //Prefixes the module with a letter if it starts with a digit
    if (/^\d/.test(result)) {
        result = "a" + result;
    }
    return result;
}

// Inspired by https://github.com/solidjs/solid-playground
/**
* Converts URL's into code. It allows for specifing multiple exports per package, through this syntax
* ```ts
* "/?q=(import)@okikio/emitter,(import)@okikio/animate,(import)@okikio/animate,(import)@okikio/animate,(import)@okikio/animate,@okikio/animate,@okikio/animate,@okikio/animate,@okikio/animate&treeshake=[T],[{+animate+}],[{+animate+as+B+}],[*+as+TR],[{+type+animate+}],[*],[{+animate+as+A+}],[*+as+PR],[{+animate+}]&share=MYewdgziA2CmB00QHMAUAiAwiG6CUQA" 
* // to
* // Click Build for the Bundled, Minified & Gzipped package size
* import T from "@okikio/emitter";
* import { animate } from "@okikio/animate";
* import { animate as B } from "@okikio/animate";
* import * as TR from "@okikio/animate";
* import { type animate } from "@okikio/animate";
* export * from "@okikio/animate";
* export { animate as A } from "@okikio/animate";
* export * as PR from "@okikio/animate";
* export { animate } from "@okikio/animate";
* console.log("Cool")
* ```
* - `q` represents the module, e.g. react, vue, etc... You can add `(import)` in-front of a specific module to make it an import instead of an export
* - `treeshake` represents the exports to treeshake. Read more about this here, {@link parseTreeshakeExports}
* - `share` represents all other code that isn't export/import
*/
export const parseSearchQuery = (shareURL: URL) => {
    try {
        const counts = new Map<string, number>();
        const searchParams = shareURL.searchParams;
        let result = "";
        let query = searchParams.get("query") || searchParams.get("q");
        let treeshake = searchParams.get("treeshake");
        if (query) {
            let queryArr = query.trim().split(",");
            let treeshakeArr = parseTreeshakeExports((treeshake ?? "").trim());
            const queryArrLen = queryArr.length;
            result += (
                "// Click Build for the Bundled, Minified & Compressed package size\n" +
                queryArr
                    .map((q, i) => {
                        const treeshakeExports =
                            treeshakeArr[i] && treeshakeArr[i].trim() !== "*"
                                ? treeshakeArr[i].trim().split(",").join(", ")
                                : "*";
                        const [, ,
                            declaration = "export",
                            module
                        ] = /^(\((.*)\))?(.*)/.exec(q)!;
                        console.log({
                            declaration,
                            treeshakeExports,
                            module,
                            treeshakeArr,
                            queryArrLen,
                            i
                        })

                        if (!(counts.has(module))) counts.set(module, 0);
                        const count = (counts.set(module, counts.get(module)! + 1).get(module)! - 1);
                        const countStr = count <= 0 ? "" : count;

                        return `${declaration} ${treeshakeExports} from ${JSON.stringify(
                            module
                        )};${(treeshake ?? "").trim().length <= 0 ?
                                `\n${declaration} { default ${declaration === "import" || queryArrLen > 1 ? `as ${getModuleName(module) + "Default" + countStr} ` : ""
                                }} from ${JSON.stringify(module)};` : ``
                            }`;
                    })
                    .join("\n")
            );
        }

        let share = searchParams.get("share");
        if (share) result += "\n" + decompressFromURL(share.trim());

        let plaintext = searchParams.get("text");
        if (plaintext) {
            result += "\n" + JSON.parse(
                /**    
                 * Support users wrapping/not-wrapping plaintext in a string, 
                 * e.g. 
                 * ```md
                 * 
                 * 
                 * /?text="console.log(document)\nconsole.log(window)"
                 * and
                 * /?text=console.log(document)\nconsole.log(window)
                 * 
                 * 
                 * are the same, they result in 
                 * ```ts
                 * console.log(document)
                 * console.log(window)
                 * ```
                */
                /^["']/.test(plaintext) && /["']$/.test(plaintext) ? plaintext : JSON.stringify("" + plaintext).replace(/\\\\/g, "\\")
            );
        }

        return result.trim();
    } catch (e) { }
};

/**
* Converts URL's into config. 
* - `config` represents the JSON config
*/
export const parseConfig = (shareURL: URL) => {
    try {
        const searchParams = shareURL.searchParams;
        const config = searchParams.get("config") ?? "{}";
        return deepAssign({}, EasyDefaultConfig, JSON.parse(config ? config : "{}"));
    } catch (e) { }
};