const PERCENTAGE_SCALE = 100;

/** Match tweb's answer shares, distributing rounding remainders so results total one hundred. */
export function getPollPercentages(poll: {
  options: ReadonlyArray<{ votes?: number | null }>;
}): number[] {
  const totalAnswers = poll.options.reduce((total, option) => total + (option.votes ?? 0), 0);
  if (!totalAnswers) {
    return poll.options.map(() => 0);
  }

  const percentages = poll.options.map((option) => {
    return ((option.votes ?? 0) / totalAnswers) * PERCENTAGE_SCALE;
  });
  const rounded = percentages.map(Math.floor);
  const remaining = PERCENTAGE_SCALE - rounded.reduce((total, percentage) => total + percentage, 0);
  const remainders = percentages.map((percentage, index) => ({
    index,
    remainder: percentage - rounded[index],
  }));
  remainders.sort((first, second) => {
    if (first.remainder === second.remainder) {
      return rounded[second.index] - rounded[first.index];
    }
    return second.remainder - first.remainder;
  });

  for (let i = 0; i < Math.min(remaining, remainders.length); i += 1) {
    rounded[remainders[i].index] += 1;
  }
  return rounded;
}
