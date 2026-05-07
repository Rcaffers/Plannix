# New Genre Studio Work – React Boilerplate

This is a React + Vite starter inspired by the structure and tone of the live `newgenre.studio/work` page.

## Included

- Sticky dark header with rounded capsule navigation
- Large editorial hero section
- Working project filters
- Responsive portfolio card grid
- CTA block
- Studio-style footer with office/contact columns

## Notes

- The live page exposes the filter labels and project names clearly, but its parsed HTML does not expose a full project-to-filter taxonomy in a reliable way. To keep the boilerplate functional, the category mappings in `src/data/projects.js` are demo mappings.
- Several cards use live image URLs discovered from linked project pages. The remaining cards use stylized gradients so you can swap in your own assets quickly.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Secrets scanning (Gitleaks)

Install Gitleaks locally (example on macOS with Homebrew):

```bash
brew install gitleaks
```

Run a local scan:

```bash
npm run secrets:check
```

CI also runs Gitleaks on pushes and pull requests via `.github/workflows/gitleaks.yml`.

## Main files

- `src/App.jsx`
- `src/data/projects.js`
- `src/components/*`
- `src/styles.css`
