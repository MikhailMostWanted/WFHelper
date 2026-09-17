import part01 from "./ru/part01.json";
import part02 from "./ru/part02.json";
import part03 from "./ru/part03.json";
import part04 from "./ru/part04.json";
import part05 from "./ru/part05.json";
import part06 from "./ru/part06.json";
import part07 from "./ru/part07.json";
import part08 from "./ru/part08.json";
import part09 from "./ru/part09.json";
import part10 from "./ru/part10.json";
import part11 from "./ru/part11.json";
import part12 from "./ru/part12.json";
import part13 from "./ru/part13.json";
import part14 from "./ru/part14.json";
import part15 from "./ru/part15.json";

// Keep the catalogue split into reviewable JSON chunks. Later chunks intentionally
// win when a catch-up translation fills a boundary gap or refines an older entry.
const ru = {
  ...part01,
  ...part02,
  ...part03,
  ...part04,
  ...part05,
  ...part06,
  ...part07,
  ...part08,
  ...part09,
  ...part10,
  ...part11,
  ...part12,
  ...part13,
  ...part14,
  ...part15,
};

export default ru;
