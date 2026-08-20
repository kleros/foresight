import EyeIcon from "@/assets/svg/eye.svg";

import { HEADING } from "./heading";

export function Outro() {
  return (
    <div className="flex flex-col items-center gap-3.5 pt-24 pb-22">
      <EyeIcon className="text-fs-accent size-6 [&_path]:fill-current" />
      <h2 className={`${HEADING} text-center text-[clamp(24px,3.4vw,40px)] leading-[1.12] font-bold`}>
        Predicting trends. Informing decisions.
      </h2>
      <p className={`${HEADING} text-center text-[clamp(15px,1.6vw,20px)] leading-[1.4] tracking-[0.04em]`}>
        Anticipate change. Act early.
      </p>
    </div>
  );
}
