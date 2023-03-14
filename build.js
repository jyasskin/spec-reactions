import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import specs from 'browser-specs' assert { type: "json" };
import fs from 'node:fs/promises';

// Minimum number of reactions to consider.
const MIN_REACTION_COUNT = 10;

// What to consider a recent reaction.
const RECENT_REACTION_DAYS = 90;

async function* iterateIssues(octokit, owner, repo) {
  for await (const response of octokit.paginate.iterator(
    octokit.rest.issues.listForRepo,
    {
      owner,
      repo,
      per_page: 100,
    },
  )) {
    for (const issue of response.data) {
      yield issue;
    }
  }
}

async function* iterateReactions(octokit, owner, repo, issue_number) {
  for await (const response of octokit.paginate.iterator(
    octokit.rest.reactions.listForIssue,
    {
      owner,
      repo,
      issue_number,
      per_page: 100,
    },
  )) {
    for (const reaction of response.data) {
      yield reaction;
    }
  }
}

async function main() {
  const recentSince = Date.now() - (RECENT_REACTION_DAYS * 24 * 3600 * 1000);

  const ThrottlingOctokit = Octokit.plugin(throttling);

  const octokit = new ThrottlingOctokit({
    auth: process.env.GITHUB_TOKEN,
    throttle: {
      onRateLimit: (retryAfter, options) => {
        console.log('');
        if (options.request.retryCount <= 2) {
          console.warn(`Rate limiting triggered, retrying after ${retryAfter} seconds!`);
          return true;
        } else {
          console.error(`Rate limiting triggered, not retrying again!`);
        }
      },
      onAbuseLimit: () => {
        console.error('Abuse limit triggered, not retrying!');
      },
    },
  });

  const repos = new Set();
  for (const spec of specs) {
    const repo = spec.nightly.repository;
    if (repo) {
      repos.add(repo);
    }
  }

  // Collect all issues into an array. This will be used to generate HTML/JSON.
  const issues = [];

  for (const repoURL of Array.from(repos).sort()) {
    const url = new URL(repoURL);
    if (url.hostname !== 'github.com') {
      continue;
    }
    const parts = url.pathname.split('/').filter((s) => s);
    if (parts.length !== 2) {
      continue;
    }

    const [owner, repo] = parts;
    try {
      for await (const issue of iterateIssues(octokit, owner, repo)) {
        const info = {
          total_reactions: issue.reactions,
          url: issue.html_url,
          title: issue.title,
        };
        if (issue.pull_request) {
          info.pull_request = { draft: issue.pull_request.draft }
        }
        if (issue.milestone) {
          info.milestone = issue.milestone.title;
        }
        if (issue.labels.length > 0) {
          info.labels = issue.labels.map(label => label.name);
        }
        if (issue.reactions.total_count >= MIN_REACTION_COUNT) {
          info.recent_reaction_count = 0;
          for await (const reaction of iterateReactions(octokit, owner, repo, issue.number)) {
            const createdAt = Date.parse(reaction.created_at);
            if (createdAt > recentSince) {
              info.recent_reaction_count++;
            }
          }
        }
        // Log the issue URL to make it easier to see if the script is stuck.
        console.log(info.url);
        issues.push(info);
      }
    } catch (error) {
      console.error("%s error while fetching issues from %s/%s: %o", error.status, owner, repo, error.response);
    }
  }

  // Write JSON output.
  const json = JSON.stringify(issues, null, '  ') + '\n';
  await fs.writeFile('issues.json', json);
}

await main();
