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

  return { staged, unstaged, untracked };
}

async function getDiff(repoPath, file, staged) {
  const git = simpleGit(repoPath);
  if (staged) {
    return git.diff(['--staged', '--', file]);
  }
  return git.diff(['--', file]);
}

module.exports = { getStatus, getDiff };
