import { createSignal } from "solid-js";

import { ToolTip } from "../../../hooks/tooltip";
import Button from "../../Button";

import IconSearch from "~icons/fluent/search-24-filled";
import IconClear from "~icons/fluent/dismiss-24-filled";

import { debounce } from "@bundle/utils/src/mod.ts";

export const [getQuery, setQuery] = createSignal("");
export function SearchInput() { 
  let ref: HTMLInputElement;

  function onClear() { 
    ref.value = "";
    setQuery("");
  }

  const onKeyUp = debounce((e?: KeyboardEvent) => {
    e?.stopPropagation?.();
    const { value } = ref;
    setQuery(value);
  }, 250);

  return (
    <div class="search">
      <div class="px-3 py-2 gap-3 flex flex-row justify-center">
        <IconSearch astro-icon />
      </div>

      <input 
        id="input" 
        type="text" 
        // @ts-ignore 
        autocorrect="off" 
        autocomplete="off" 
        placeholder="Type a package name..." 
        onKeyUp={onKeyUp} 
        ref={ref} 
      /> 

      <ToolTip content="Clear Search Input and Results"> 
        <Button id="clear" aria-label="Clear search input and results" class="umami--click--search-clear-button" onClick={onClear}>
          <IconClear astro-icon />
        </Button>
      </ToolTip> 
    </div>
  );
}

export default SearchInput;