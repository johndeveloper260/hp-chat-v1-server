/**
 * Poll projection — the one place that decides what a viewer learns about a poll.
 *
 * Respondents never see results. Counts are computed unconditionally in SQL
 * (the feed and the single-poll lookup share one shape) and stripped here for
 * anyone who is not OFFICER/ADMIN. Every code path that hands a poll to a
 * client — feed list, create/update responses — must go through
 * projectPollForViewer(); the respond endpoints return only the caller's own
 * option ids and never a poll.
 */
import { isWithinFeedWindow } from "./announcementVisibility.js";

const ELEVATED = ["OFFICER", "ADMIN"];

/**
 * Open = not manually locked, not past its scheduled close, and the bulletin
 * itself is live (active and inside date_from–date_to).
 */
export const isPollOpen = (poll, announcement, now = new Date()) =>
  Boolean(poll) && !poll.is_locked &&
  (!poll.closes_at || new Date(poll.closes_at) > now) &&
  isWithinFeedWindow(announcement, now);

/**
 * Whitelists the contract fields rather than spreading the DB row: the poll
 * row carries created_by / locked_by / updated_by / business_unit, none of
 * which belong to a client payload.
 *
 * @param {object|null} poll  - row from pollRepository.findPollByAnnouncement
 *   or the feed's `poll` JSON column
 * @param {object} announcement - the bulletin row (active, date_from, date_to)
 * @param {{ userType: string }} viewer - from announcementAccess.resolveViewer
 */
export const projectPollForViewer = (poll, announcement, viewer, now = new Date()) => {
  if (!poll) return null;
  const elevated = ELEVATED.includes(viewer?.userType);

  const projected = {
    poll_id:        poll.poll_id,
    question:       poll.question,
    allow_multiple: Boolean(poll.allow_multiple),
    closes_at:      poll.closes_at ?? null,
    is_locked:      Boolean(poll.is_locked),
    is_open:        isPollOpen(poll, announcement, now),
    has_responses:  Boolean(poll.has_responses),
    options:        (poll.options ?? []).map((option) => {
      const projectedOption = {
        option_id:  option.option_id,
        label:      option.label,
        sort_order: option.sort_order,
      };
      if (elevated) projectedOption.count = Number(option.count ?? 0);
      return projectedOption;
    }),
    my_option_ids:  poll.my_option_ids ?? [],
    has_responded:  Boolean(poll.has_responded),
  };
  if (elevated) projected.total_respondents = Number(poll.total_respondents ?? 0);
  return projected;
};
