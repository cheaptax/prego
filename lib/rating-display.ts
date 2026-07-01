/** 1~5점 → 운영자용 만족도 라벨 */
export function getRatingSatisfactionLabel(score?: number) {
  if (typeof score !== "number" || Number.isNaN(score)) return "평가완료";
  if (score >= 4) return "만족";
  if (score >= 3) return "보통";
  return "불만족";
}

export function getRatingSatisfactionTone(score?: number) {
  if (typeof score !== "number" || Number.isNaN(score)) return "slate";
  if (score >= 4) return "green";
  if (score >= 3) return "blue";
  return "amber";
}

export function formatRatingScore(score?: number) {
  if (typeof score !== "number" || Number.isNaN(score)) return "-";
  return `${score.toFixed(1)} / 5.0`;
}
