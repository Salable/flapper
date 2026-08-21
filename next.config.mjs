/** @type {import('next').NextConfig} */
const nextConfig = {
  // PGlite loads its WASM and filesystem bundles from disk relative to the
  // package; bundling it breaks those paths, so it runs as a plain require.
  serverExternalPackages: ['@electric-sql/pglite'],
  // /docs reads the repo's markdown at request time; trace it into the bundle.
  outputFileTracingIncludes: { '/docs/[doc]': ['./docs/*.md'] },
  async headers() {
    return [
      {
        // The drawn themes' glyph font. Versioned by filename if it ever changes.
        source: '/fonts/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
