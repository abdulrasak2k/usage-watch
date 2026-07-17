# Standalone GitHub repository setup

Use this when you want `@bns/provider-usage` in its own GitHub repository and then install it into multiple projects.

## 1. Create the GitHub repository

Recommended repository name:

```txt
bns-provider-usage
```

Recommended visibility:

- Private if this is only for your company/projects.
- Public only if you are comfortable sharing the package source.

## 2. Copy this package folder into the new repo

From the BNS File Tracking project root:

```bash
cp -R packages/provider-usage ../bns-provider-usage
cd ../bns-provider-usage
```

The standalone repo root should contain:

```txt
.env.example
.gitignore
LICENSE
README.md
docs/
examples/
package.json
src/
tsconfig.json
```

## 3. Initialize Git

```bash
git init
git add .
git commit -m "Initial provider usage package"
git branch -M main
git remote add origin git@github.com:abdulrasak2k/bns-provider-usage.git
git push -u origin main
```

If you use HTTPS instead of SSH:

```bash
git remote add origin https://github.com/abdulrasak2k/bns-provider-usage.git
```

## 4. Test installation from another project

In a different project:

```bash
npm install github:abdulrasak2k/bns-provider-usage
```

For a private repo, SSH is usually smoother:

```bash
npm install git+ssh://git@github.com/abdulrasak2k/bns-provider-usage.git
```

## 5. Pin versions with tags

Create a tag when the package is stable:

```bash
npm version patch
git push origin main --tags
```

Then install that exact version:

```bash
npm install github:abdulrasak2k/bns-provider-usage#v0.1.1
```

This is better than installing `main` in production because it avoids surprise changes.

## 6. Updating host projects

When you release a new tag:

```bash
npm install github:abdulrasak2k/bns-provider-usage#v0.1.2
```

Then commit the updated host app `package.json` and lockfile.
