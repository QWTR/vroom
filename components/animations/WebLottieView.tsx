import React, { useMemo } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

type Props = {
  data: unknown;
  loop?: boolean;
  style?: ViewStyle;
};

export default function WebLottieView({ data, loop = true, style }: Props) {
  const html = useMemo(() => {
    const payload = JSON.stringify(data).replace(/</g, '\\u003c');
    return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body, #root { margin:0; padding:0; width:100%; height:100%; background:transparent; overflow:hidden; }
    svg { width:100% !important; height:100% !important; display:block; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
  <script>
    (function () {
      var animationData = ${payload};
      function start() {
        if (!window.lottie) return setTimeout(start, 30);
        window.lottie.loadAnimation({
          container: document.getElementById('root'),
          renderer: 'svg',
          loop: ${loop ? 'true' : 'false'},
          autoplay: true,
          animationData: animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true }
        });
      }
      start();
    })();
  </script>
</body>
</html>`;
  }, [data, loop]);

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={[styles.webview, style]}
      containerStyle={styles.container}
      scrollEnabled={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      bounces={false}
      javaScriptEnabled
      domStorageEnabled={false}
      pointerEvents="none"
      androidLayerType="hardware"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
  },
  webview: {
    backgroundColor: 'transparent',
  },
});
