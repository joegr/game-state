// game-state — where captains' submissions go. Left empty in git on purpose:
// deploy.yml overwrites this file in the published site with the tentative
// repo's name and the SUBMIT_TOKEN secret (a token that can only start
// workflows there and read their check results). With it empty, the site
// says submissions are not connected yet.
export const SUBMIT = { repo: null, token: null };
