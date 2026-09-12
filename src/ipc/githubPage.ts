import type { Comment, Issue, PullRequest, Review } from '../types/git';
import type { GithubPage, GithubPrDiffPage } from '../types/githubPage';
import { invoke } from './invoke';

export function githubIssuePage(repoRoot: string, state: string, pageNumber: number): Promise<GithubPage<Issue>> {
  return invoke('gh_issue_page', { repoRoot, state, pageNumber });
}
export function githubPrPage(repoRoot: string, pageNumber: number): Promise<GithubPage<PullRequest>> {
  return invoke('gh_pr_page', { repoRoot, pageNumber });
}
export function githubCommentPage(repoRoot: string, number: number, pageNumber: number): Promise<GithubPage<Comment>> {
  return invoke('gh_comment_page', { repoRoot, number, pageNumber });
}
export function githubReviewPage(repoRoot: string, number: number, pageNumber: number): Promise<GithubPage<Review>> {
  return invoke('gh_review_page', { repoRoot, number, pageNumber });
}
export function githubPrDiffPage(repoRoot: string, number: number, pageNumber: number, expectedHead: string | null, expectedBase: string | null): Promise<GithubPrDiffPage> {
  return invoke('gh_pr_diff_page', { repoRoot, number, pageNumber, expectedHead, expectedBase });
}
export function githubPrLocalBase(repoRoot: string, baseOid: string, headOid: string): Promise<string> {
  return invoke('gh_pr_local_base', { repoRoot, baseOid, headOid });
}
