const simpleGit = require('simple-git');

async function getStatus(repoPath) {
  const git = simpleGit(repoPath);
  const status = await git.status();

  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (const file of status.files) {
    if (file.working_dir === '?') {
      untracked.push(file.path);
      continue;
    }
    if (file.index !== ' ' && file.index !== '?') {
      staged.push(file.path);
    }
    if (file.working_dir !== ' ' && file.working_dir !== '?') {
      unstaged.push(file.path);
    }
  }

  return { staged, unstaged, untracked, branch: status.current };
}

async function getDiff(repoPath, file, staged) {
  const git = simpleGit(repoPath);
  if (staged) {
    return git.diff(['--staged', '--', file]);
  }
  return git.diff(['--', file]);
}

async function stageFiles(repoPath, files) {
  const git = simpleGit(repoPath);
  await git.add(files);
}

async function commitChanges(repoPath, message) {
  const git = simpleGit(repoPath);
  const result = await git.commit(message);
  return result.commit;
}

async function pushChanges(repoPath) {
  const git = simpleGit(repoPath);
  await git.push();
}

async function getRecentCommits(repoPath, count = 20) {
  const git = simpleGit(repoPath);
  const log = await git.log({ maxCount: count });
  return log.all.map((commit) => ({
    hash: commit.hash,
    shortHash: commit.hash.slice(0, 7),
    subject: commit.message,
    author: commit.author_name,
    date: commit.date,
  }));
}

// Used when adding a folder, so the tray app can reject a path that isn't a
// git repo before it ever reaches the phone as a confusing per-command error.
async function isGitRepo(repoPath) {
  try {
    return await simpleGit(repoPath).checkIsRepo();
  } catch {
    return false;
  }
}

async function getBranches(repoPath) {
  const git = simpleGit(repoPath);
  const summary = await git.branchLocal();
  return { current: summary.current, all: summary.all };
}

// Branches off `from` when given, otherwise off whatever HEAD currently is —
// matching `git checkout -b <name> [<from>]`.
async function createBranch(repoPath, name, from) {
  const git = simpleGit(repoPath);
  if (from) {
    await git.checkout(['-b', name, from]);
  } else {
    await git.checkoutLocalBranch(name);
  }
}

async function checkoutBranch(repoPath, name) {
  const git = simpleGit(repoPath);
  await git.checkout(name);
}

module.exports = {
  getStatus,
  getDiff,
  stageFiles,
  commitChanges,
  pushChanges,
  getRecentCommits,
  isGitRepo,
  getBranches,
  createBranch,
  checkoutBranch,
};
