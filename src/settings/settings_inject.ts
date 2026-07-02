console.log("Injected");

import { VNStorage } from "../vn/vn_storage";
import Settings from "./settings.svelte";
import { mount } from "svelte";

const setup = async () => {
  const vn_storage = await VNStorage.build(true);

  mount(Settings, {
    target: document.documentElement,
    props: {
      vn_storage,
    },
  });
};
setup();

export {};
