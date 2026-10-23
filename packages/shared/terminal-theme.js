// The server answers startup color queries before a browser terminal attaches.
// Keep those answers identical to the colors the browser actually renders.
export const terminalColors = Object.freeze({
  10: '#ececee',
  11: '#101113',
  12: '#ececee',
});

export const terminalTheme = Object.freeze({
  foreground: terminalColors[10],
  background: terminalColors[11],
  cursor: terminalColors[12],
});
