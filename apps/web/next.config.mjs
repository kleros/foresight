/**
 * Headers that restrict nothing the app loads. No CSP or frame-ancestors: Reown's
 * iframes, relays and wallet-specific origins would each need allowlisting.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [],
  },
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
  webpack: (config) => {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) => rule.test?.test?.(".svg"));

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...fileLoaderRule.resourceQuery.not, /url/] }, // exclude if *.svg?url
        use: [
          {
            loader: "@svgr/webpack",
            options: {
              // svgr's own defaults, keeping the viewBox (an undersized icon clips
              // without it); prefixIds keeps inlined icons' clipPath ids from colliding.
              svgoConfig: {
                plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }, "prefixIds"],
              },
            },
          },
        ],
      },
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    // Wallet SDKs we deliberately don't ship.
    const unusedWalletSdks = [
      "@base-org/account",
      "@coinbase/wallet-sdk",
      "@metamask/connect-evm",
      "@walletconnect/ethereum-provider",
      "accounts",
      "porto",
      "porto/internal",
    ];

    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(unusedWalletSdks.map((pkg) => [pkg, false])),
    };

    return config;
  },
};

export default nextConfig;
