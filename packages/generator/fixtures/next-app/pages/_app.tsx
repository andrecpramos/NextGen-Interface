export default function App({ Component, pageProps }: { Component: React.ComponentType; pageProps: object }) {
  return <Component {...pageProps} />;
}
