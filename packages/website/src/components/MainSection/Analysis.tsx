import type { ComponentProps, JSX } from "solid-js";
import Details from "../Details";
import Loading from "../Loading";
import DragHandle from "./EditorSection/DragHandle";

export function Analysis(props?: ComponentProps<"details">) {
  return (
    <div class="details-section">
      <Details
        class="inline-details umami--toggle--analysis-accordian"
        summary="Analysis"
        contentClass="pr-5"
      >
        {props.children}
        <div class="relative w-full">
          <div class="relative w-full min-h-[150px]">
            <div class="analysis-loader">
              <div class="text-center">
                <Loading show={false}></Loading>

                <p class="loader-content">Nothing to analyze...</p>
              </div>
            </div>
            <iframe
              class="analysis-iframe"
              title="Bundle Analysis"
              id="analyzer"
              src="about:blank"
              sandbox="allow-scripts"
            ></iframe>
          </div>
          <DragHandle direction="y" />
        </div>
      </Details>
    </div>
  );
}

export default Analysis;
