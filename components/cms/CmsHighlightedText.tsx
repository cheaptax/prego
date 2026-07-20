export function CmsHighlightedText({
  text,
  highlight,
}: {
  text: string;
  highlight?: string;
}) {
  if (!highlight || !text.includes(highlight)) return text;
  const [before, ...after] = text.split(highlight);
  return (
    <>
      {before}
      <em>{highlight}</em>
      {after.join(highlight)}
    </>
  );
}
