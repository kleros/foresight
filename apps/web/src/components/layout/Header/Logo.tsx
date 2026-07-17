import Link from "next/link";
import React from "react";

import BuiltByKlerosLogo from "@/assets/logo/built-by-kleros.svg";
import ForesightLogo from "@/assets/logo/foresight-logo-navbar.svg";

const Logo: React.FC = () => {
  return (
    <div className="flex items-center md:ml-2">
      <Link href="/" className="flex items-center">
        <ForesightLogo />
      </Link>
      <BuiltByKlerosLogo />
    </div>
  );
};

export default Logo;
