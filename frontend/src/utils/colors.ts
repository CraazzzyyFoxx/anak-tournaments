export const getWinrateColor = (winrate: number) => {
  if (winrate > 1) {
    winrate = winrate / 100;
  }
  if (winrate < 0.46) {
    return "#ff9999"; // pastel red
  }
  if (winrate < 0.5) {
    return "#ffcc99"; // pastel orange
  }
  if (winrate < 0.53) {
    return "#ffff99"; // pastel yellow
  }
  if (winrate < 0.58) {
    return "#99ff99"; // pastel green
  }
  if (winrate < 0.64) {
    return "#99ffff"; // pastel cyan
  }
  return "#cc99ff"; // pastel purple
};
