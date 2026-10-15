// Controller fixtures retain real controls and containers; browser tests check
// Astro slot placement and layout.
export async function expandGameControls(html, component) {
  html = html.replace(/<GameTutorial\b[^>]*\/>/, await component('GameTutorial'));
  html = html.replace(/<GameReviewControls\b[^>]*\/>/, await component('GameReviewControls'));
  const round = await component('GameRoundControls');
  return html.replace(/<GameRoundControls\b([^>]*?)(?:\/>|>([\s\S]*?)<\/GameRoundControls>)/, (_, props, content = '') =>
    round.replace('<slot name="before" />', '').replace('<slot />', content)
      .replace('{resultLabel}', props.match(/resultLabel="([^"]*)"/)?.[1] ?? 'Scores'));
}
