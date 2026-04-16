function buildEventAnalytics(participants = []) {
  const totalParticipants = participants.length;

  const arrivedParticipantsList = participants.filter((p) => p.isOnline === true);
  const arrivedParticipants = arrivedParticipantsList.length;

  const arrivalRate =
    totalParticipants > 0
      ? Math.round((arrivedParticipants / totalParticipants) * 100)
      : 0;

  const activeUsersList = arrivedParticipantsList.filter((p) => {
    const i = p.interactions || {};
    return (
      (i.saved?.length || 0) > 0 ||
      (i.met?.length || 0) > 0 ||
      (i.skipped?.length || 0) > 0
    );
  });

  const activeUsersCount = activeUsersList.length;

  const activeUsersRate =
    arrivedParticipants > 0
      ? Math.round((activeUsersCount / arrivedParticipants) * 100)
      : 0;

  const totalSaved = participants.reduce(
    (sum, p) => sum + (p.interactions?.saved?.length || 0),
    0
  );

  const totalMet = participants.reduce(
    (sum, p) => sum + (p.interactions?.met?.length || 0),
    0
  );

  const totalSkipped = participants.reduce(
    (sum, p) => sum + (p.interactions?.skipped?.length || 0),
    0
  );

  const totalInteractions = totalSaved + totalMet + totalSkipped;

  const avgSavedPerParticipant =
    arrivedParticipants > 0 ? Math.ceil(totalSaved / arrivedParticipants) : 0;

  const avgMetPerParticipant =
    arrivedParticipants > 0 ? Math.ceil(totalMet / arrivedParticipants) : 0;

  const avgSkippedPerParticipant =
    arrivedParticipants > 0 ? Math.ceil(totalSkipped / arrivedParticipants) : 0;

  const avgTotalInteractionsPerParticipant =
    arrivedParticipants > 0
      ? Math.ceil(totalInteractions / arrivedParticipants)
      : 0;

  return {
    totalParticipants,
    arrivedParticipants,
    arrivalRate,
    activeUsersCount,
    activeUsersRate,
    totals: {
      saved: totalSaved,
      met: totalMet,
      skipped: totalSkipped,
      totalInteractions,
    },
    averages: {
      savedPerParticipant: avgSavedPerParticipant,
      metPerParticipant: avgMetPerParticipant,
      skippedPerParticipant: avgSkippedPerParticipant,
      totalInteractionsPerParticipant: avgTotalInteractionsPerParticipant,
    },
  };
}

module.exports = { buildEventAnalytics };