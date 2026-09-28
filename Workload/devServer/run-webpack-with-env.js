const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const environment = process.argv[2] || 'dev';
const command = process.argv[3] === 'serve' ? 'serve' : 'build';
const extraArgs = process.argv.slice(command === 'serve' ? 4 : 3);
const workloadRoot = path.resolve(__dirname, '..');

const preferredFileByEnvironment = {
    dev: '.env.dev',
    test: '.env.test',
    prod: '.env.prod',
};

const preferredFile = preferredFileByEnvironment[environment] || '.env.dev';
const envCandidates = [preferredFile, '.env.dev', '.env.template'];
const selectedEnvFile = envCandidates.find((file) => fs.existsSync(path.join(workloadRoot, file)));

if (!selectedEnvFile) {
    console.error('[Build] No environment file found. Expected one of: .env.dev, .env.test, .env.prod, .env.template');
    process.exit(1);
}

if (selectedEnvFile !== preferredFile) {
    console.warn(`[Build] ${preferredFile} not found. Falling back to ${selectedEnvFile}.`);
}

const loadedFiles = [selectedEnvFile];
const mergedEnv = dotenv.parse(fs.readFileSync(path.join(workloadRoot, selectedEnvFile)));

const localCandidates = [];
if (selectedEnvFile !== '.env.template') {
    localCandidates.push(`${selectedEnvFile}.local`);
}
if (preferredFile !== selectedEnvFile) {
    localCandidates.push(`${preferredFile}.local`);
}

for (const localFile of localCandidates) {
    const localPath = path.join(workloadRoot, localFile);
    if (!fs.existsSync(localPath)) {
        continue;
    }

    Object.assign(mergedEnv, dotenv.parse(fs.readFileSync(localPath)));
    loadedFiles.push(localFile);
}

console.log(`[Build] Loaded environment files: ${loadedFiles.join(', ')}`);

const childEnv = {
    ...mergedEnv,
    ...process.env,
};

const webpackArgs = [];
if (command === 'serve') {
    webpackArgs.push('serve', '--config', './devServer/webpack.dev.js', ...extraArgs);
} else {
    webpackArgs.push('--config', './webpack.config.js', '--output-path', '../build/Frontend');
    if (environment === 'prod') {
        webpackArgs.push('--mode', 'production', '--progress');
    } else {
        webpackArgs.push('--mode', 'development', '--progress');
    }
}

const webpackCliEntry = require.resolve('webpack-cli/bin/cli.js', { paths: [workloadRoot] });

const result = spawnSync(
    process.execPath,
    [webpackCliEntry, ...webpackArgs],
    {
        cwd: workloadRoot,
        env: childEnv,
        stdio: 'inherit',
        shell: false,
    }
);

if (result.error) {
    console.error('[Build] Failed to execute webpack:', result.error.message);
}

process.exit(result.status ?? 1);