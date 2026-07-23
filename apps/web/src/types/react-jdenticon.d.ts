declare module "react-jdenticon" {
  import type { FC } from "react";

  interface IdenticonProps {
    value?: string;
    size?: string | number;
  }

  const Identicon: FC<IdenticonProps>;
  export default Identicon;
}
