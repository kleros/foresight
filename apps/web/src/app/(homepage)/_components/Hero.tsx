import Link from "next/link";

import ForesightMark from "@/assets/logo/foresight-mark.svg";
import EyeIcon from "@/assets/svg/eye.svg";

import { paths } from "@/config/paths";

import { HEADING } from "./heading";

export function Hero() {
  return (
    <section className="fs-hero">
      <div className="fs-eye-field">
        <div className="fs-eye-drift" />
      </div>
      <div className="fs-enter relative flex flex-col items-center gap-4.5 pt-16 pb-14 text-center">
        <ForesightMark className="h-38 w-38" role="presentation" />
        <EyeIcon className="text-fs-accent size-6 [&_path]:fill-current" />
        <h1 className={`${HEADING} max-w-[26ch] text-[clamp(30px,4.6vw,56px)] leading-[1.08] font-bold`}>
          See further. Decide smarter.
        </h1>
        <p className={`${HEADING} text-base leading-5.5 tracking-[0.06em]`}>Explore available predictions</p>
        <Link className="fs-cta type-label mt-2.5" href={paths.create.getHref()}>
          Create a session
        </Link>
      </div>
    </section>
  );
}
