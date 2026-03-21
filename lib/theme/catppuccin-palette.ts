/**
 * Pre-computed oklch values for all 4 Catppuccin flavors.
 * 26 colors × 4 flavors = 104 values.
 *
 * Source hex values from https://github.com/catppuccin/catppuccin
 * Converted to oklch(L C H) with 3-decimal precision.
 */

export interface CatppuccinPalette {
  base: string;
  mantle: string;
  crust: string;
  text: string;
  subtext1: string;
  subtext0: string;
  overlay2: string;
  overlay1: string;
  overlay0: string;
  surface2: string;
  surface1: string;
  surface0: string;
  rosewater: string;
  flamingo: string;
  pink: string;
  mauve: string;
  red: string;
  maroon: string;
  peach: string;
  yellow: string;
  green: string;
  teal: string;
  sky: string;
  sapphire: string;
  blue: string;
  lavender: string;
}

export type CatppuccinFlavor = "mocha" | "macchiato" | "frappe" | "latte";

export const catppuccinPalettes: Record<CatppuccinFlavor, CatppuccinPalette> = {
  mocha: {
    base: "oklch(0.243 0.030 283.9)",
    mantle: "oklch(0.216 0.025 284.1)",
    crust: "oklch(0.183 0.020 284.2)",
    text: "oklch(0.879 0.043 272.3)",
    subtext1: "oklch(0.817 0.040 272.8)",
    subtext0: "oklch(0.751 0.040 273.9)",
    overlay2: "oklch(0.687 0.037 274.7)",
    overlay1: "oklch(0.618 0.037 276.0)",
    overlay0: "oklch(0.550 0.035 277.1)",
    surface2: "oklch(0.477 0.034 278.6)",
    surface1: "oklch(0.404 0.032 280.1)",
    surface0: "oklch(0.324 0.032 282.0)",
    rosewater: "oklch(0.923 0.024 30.3)",
    flamingo: "oklch(0.880 0.042 17.9)",
    pink: "oklch(0.870 0.075 336.3)",
    mauve: "oklch(0.787 0.119 304.8)",
    red: "oklch(0.756 0.130 2.7)",
    maroon: "oklch(0.782 0.090 8.8)",
    peach: "oklch(0.824 0.101 52.6)",
    yellow: "oklch(0.919 0.070 86.5)",
    green: "oklch(0.858 0.109 142.8)",
    teal: "oklch(0.858 0.079 182.8)",
    sky: "oklch(0.847 0.083 210.3)",
    sapphire: "oklch(0.791 0.097 228.7)",
    blue: "oklch(0.766 0.111 259.9)",
    lavender: "oklch(0.817 0.091 277.3)",
  },
  macchiato: {
    base: "oklch(0.279 0.035 276.9)",
    mantle: "oklch(0.249 0.031 278.4)",
    crust: "oklch(0.219 0.025 280.6)",
    text: "oklch(0.871 0.048 273.7)",
    subtext1: "oklch(0.812 0.046 274.3)",
    subtext0: "oklch(0.751 0.044 273.5)",
    overlay2: "oklch(0.690 0.043 274.5)",
    overlay1: "oklch(0.627 0.042 273.7)",
    overlay0: "oklch(0.561 0.041 276.5)",
    surface2: "oklch(0.494 0.039 275.7)",
    surface1: "oklch(0.426 0.039 276.9)",
    surface0: "oklch(0.354 0.037 276.0)",
    rosewater: "oklch(0.911 0.029 31.0)",
    flamingo: "oklch(0.863 0.048 18.0)",
    pink: "oklch(0.861 0.083 336.1)",
    mauve: "oklch(0.772 0.126 303.9)",
    red: "oklch(0.737 0.125 11.2)",
    maroon: "oklch(0.770 0.102 14.3)",
    peach: "oklch(0.799 0.106 49.6)",
    yellow: "oklch(0.879 0.074 84.8)",
    green: "oklch(0.835 0.108 138.2)",
    teal: "oklch(0.821 0.076 184.2)",
    sky: "oklch(0.837 0.072 209.4)",
    sapphire: "oklch(0.785 0.085 228.4)",
    blue: "oklch(0.750 0.110 263.8)",
    lavender: "oklch(0.814 0.083 279.8)",
  },
  frappe: {
    base: "oklch(0.329 0.032 274.8)",
    mantle: "oklch(0.297 0.029 276.2)",
    crust: "oklch(0.272 0.026 275.1)",
    text: "oklch(0.862 0.053 273.3)",
    subtext1: "oklch(0.808 0.051 272.7)",
    subtext0: "oklch(0.752 0.048 274.5)",
    overlay2: "oklch(0.697 0.046 273.8)",
    overlay1: "oklch(0.640 0.043 272.6)",
    overlay0: "oklch(0.581 0.042 275.2)",
    surface2: "oklch(0.521 0.039 274.0)",
    surface1: "oklch(0.460 0.037 273.0)",
    surface0: "oklch(0.395 0.034 275.9)",
    rosewater: "oklch(0.895 0.034 31.5)",
    flamingo: "oklch(0.844 0.055 18.2)",
    pink: "oklch(0.850 0.089 336.2)",
    mauve: "oklch(0.765 0.111 311.7)",
    red: "oklch(0.717 0.124 19.4)",
    maroon: "oklch(0.765 0.098 17.1)",
    peach: "oklch(0.773 0.111 47.7)",
    yellow: "oklch(0.844 0.079 83.5)",
    green: "oklch(0.812 0.107 133.4)",
    teal: "oklch(0.783 0.073 184.7)",
    sky: "oklch(0.825 0.059 209.8)",
    sapphire: "oklch(0.780 0.073 227.9)",
    blue: "oklch(0.742 0.105 265.7)",
    lavender: "oklch(0.810 0.076 283.7)",
  },
  latte: {
    base: "oklch(0.958 0.006 264.5)",
    mantle: "oklch(0.933 0.009 264.5)",
    crust: "oklch(0.906 0.012 264.5)",
    text: "oklch(0.435 0.043 279.3)",
    subtext1: "oklch(0.492 0.039 279.3)",
    subtext0: "oklch(0.547 0.034 279.1)",
    overlay2: "oklch(0.601 0.031 278.7)",
    overlay1: "oklch(0.654 0.027 278.1)",
    overlay0: "oklch(0.708 0.024 274.6)",
    surface2: "oklch(0.758 0.021 273.1)",
    surface1: "oklch(0.808 0.017 271.2)",
    surface0: "oklch(0.857 0.015 268.5)",
    rosewater: "oklch(0.714 0.105 33.1)",
    flamingo: "oklch(0.686 0.126 20.8)",
    pink: "oklch(0.726 0.174 338.4)",
    mauve: "oklch(0.555 0.250 297.0)",
    red: "oklch(0.550 0.215 19.8)",
    maroon: "oklch(0.625 0.197 20.3)",
    peach: "oklch(0.692 0.204 42.4)",
    yellow: "oklch(0.714 0.149 67.8)",
    green: "oklch(0.625 0.177 140.5)",
    teal: "oklch(0.602 0.098 201.1)",
    sky: "oklch(0.682 0.145 235.4)",
    sapphire: "oklch(0.648 0.107 212.9)",
    blue: "oklch(0.559 0.226 262.1)",
    lavender: "oklch(0.664 0.175 273.1)",
  },
};
