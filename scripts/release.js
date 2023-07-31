/**
 * modified from https://github.com/vuejs/vue-next/blob/master/scripts/release.js
 */
// 发布流程
// 1.确定发布版本号
// 2.更新package文件夹下包的版本
// 3.打包编译
// 4.生成changeLog
// 5.提交代码
// 6.发布包(npm)
// 7.推送代码到gitlab

const execa = require('execa');
const path = require('path');
const fs = require('fs');
const args = require('minimist')(process.argv.slice(2));
const semver = require('semver');
const chalk = require('chalk');
const prompts = require('prompts');

const pkgDir = process.cwd();
const pkgPath = path.resolve(pkgDir, 'package.json');
/**
 * @type {{ name: string, version: string }}
 */
const pkg = require(pkgPath);
const pkgName = pkg.name.replace(/^@vitejs\//, '');

const currentVersion = pkg.version;
/**
 * @type {boolean}
 */
const isDryRun = args.dry;
/**
 * @type {boolean}
 */
const skipBuild = args.skipBuild;

/**
 * @type {import('semver').ReleaseType[]}
 */
const versionIncrements = ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'];

/**
 * @param {import('semver').ReleaseType} i
 */
const inc = (i) => semver.inc(currentVersion, i, 'beta');

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {object} opts
 */
const run = (bin, args, opts = {}) => execa(bin, args, { stdio: 'inherit', ...opts });

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {object} opts
 */
const dryRun = (bin, args, opts = {}) => console.log(chalk.blue(`[dryrun] ${bin} ${args.join(' ')}`), opts);

const runIfNotDry = isDryRun ? dryRun : run;

/**
 * @param {string} msg
 */
const step = (msg) => console.log(chalk.cyan(msg));

async function main() {
  let targetVersion = args._[0];

  if (!targetVersion) {
    // no explicit version, offer suggestions
    /**
     * @type {{ release: string }}
     */
    const { release } = await prompts({
      type: 'select',
      name: 'release',
      message: 'Select release type',
      choices: versionIncrements
        .map((i) => `${i} (${inc(i)})`)
        .concat(['custom'])
        .map((i) => ({ value: i, title: i })),
    });

    if (release === 'custom') {
      /**
       * @type {{ version: string }}
       */
      const res = await prompts({
        type: 'text',
        name: 'version',
        message: 'Input custom version',
        initial: currentVersion,
      });
      targetVersion = res.version;
    } else {
      targetVersion = release.match(/\((.*)\)/)[1];
    }
  }

  if (!semver.valid(targetVersion)) {
    throw new Error(`invalid target version: ${targetVersion}`);
  }

  const tag = pkgName === 'vite' ? `v${targetVersion}` : `${pkgName}@${targetVersion}`;

  if (targetVersion.includes('beta') && !args.tag) {
    /**
     * @type {{ tagBeta: boolean }}
     */
    const { tagBeta } = await prompts({
      type: 'confirm',
      name: 'tagBeta',
      message: `Publish under dist-tag "beta"?`,
    });

    if (tagBeta) args.tag = 'beta';
  }

  /**
   * @type {{ yes: boolean }}
   */
  const { yes } = await prompts({
    type: 'confirm',
    name: 'yes',
    message: `Releasing ${tag}. Confirm?`,
  });

  if (!yes) {
    return;
  }

  step('\nUpdating package version...');
  updateVersion(targetVersion);

  step('\nBuilding package...');
  if (!skipBuild && !isDryRun) {
    await run('pnpm', ['build']);
  } else {
    console.log(`(skipped)`);
  }

  // step('\nGenerating changelog...');
  // await run('yarn', ['changelog']);

  const { stdout } = await run('git', ['diff'], { stdio: 'pipe' });
  if (stdout) {
    step('\nCommitting changes...');
    await runIfNotDry('git', ['add', '-A']);
    await runIfNotDry('git', ['commit', '--no-verify', '-m', `release: ${tag}`]);
  } else {
    console.log('No changes to commit.');
  }

  step('\nPublishing package...');
  await publishPackage(targetVersion, runIfNotDry);

  step('\nPushing to GitLab...');
  await runIfNotDry('git', ['tag', tag]);
  await runIfNotDry('git', ['push', 'origin', `refs/tags/${tag}`]);
  await runIfNotDry('git', ['push']);

  if (isDryRun) {
    console.log(`\nDry run finished - run git diff to see package changes.`);
  }

  console.log();
}

/**
 * @param {string} version
 */
function updateVersion(version) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * @param {string} version
 * @param {Function} runIfNotDry
 */
async function publishPackage(version, runIfNotDry) {
  const publicArgs = [
    'publish',
    '--access',
    'public',
    'https://registry.npmjs.org/',
    '--no-git-checks'
  ];
  if (args.tag) {
    publicArgs.push(`--tag`, args.tag);
  }
  try {
    await runIfNotDry('pnpm', publicArgs, {
      stdio: 'pipe',
    });
    console.log(chalk.green(`Successfully published ${pkgName}@${version}`));
  } catch (e) {
    if (e.stderr.match(/previously published/)) {
      console.log(chalk.red(`Skipping already published: ${pkgName}`));
    } else {
      throw e;
    }
  }
}

main().catch((err) => {
  console.error(err);
});