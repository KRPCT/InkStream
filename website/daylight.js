const document = globalThis.document;
document.documentElement.classList.add('has-js');

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#primary-nav');

function closeMenu(returnFocus = false) {
  if (!menuButton || !navigation) return;
  navigation.classList.remove('is-open');
  menuButton.setAttribute('aria-expanded', 'false');
  if (returnFocus) menuButton.focus();
}

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  navigation?.classList.toggle('is-open', open);
});
navigation?.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    closeMenu(true);
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.site-header')) closeMenu();
});
globalThis.matchMedia('(min-width: 801px)').addEventListener('change', (event) => {
  if (event.matches) closeMenu();
});

for (const gallery of document.querySelectorAll('[data-gallery]')) {
  const tabs = [...gallery.querySelectorAll('[role="tab"]')];
  function activate(tab, focus = false) {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(candidate.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    }
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        activate(tabs[next], true);
      }
    });
  });
}

const releaseVersion = [2, 1, 0];
const assetPatterns = {
  windows: /_x64-setup\.exe$/,
  macos: /_aarch64\.dmg$/,
  linux: /_amd64\.AppImage$/,
  deb: /_amd64\.deb$/,
};

function trustedRelease(release) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(release?.tag_name ?? '');
  if (!match || release.draft || release.prerelease || !Array.isArray(release.assets)) return null;
  const version = match.slice(1).map(Number);
  if (!version.every(Number.isSafeInteger)) return null;
  const difference = version.findIndex((part, index) => part !== releaseVersion[index]);
  if (difference !== -1 && version[difference] < releaseVersion[difference]) return null;
  const tag = release.tag_name;
  const urls = {};
  for (const [platform, pattern] of Object.entries(assetPatterns)) {
    const candidates = release.assets.filter(
      (asset) =>
        typeof asset.name === 'string' &&
        asset.name.startsWith(`InkStream_${version.join('.')}_`) &&
        pattern.test(asset.name) &&
        asset.state === 'uploaded' &&
        asset.size > 0,
    );
    if (candidates.length !== 1) return null;
    const asset = candidates[0];
    const url = new globalThis.URL(asset.browser_download_url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== `/KRPCT/InkStream/releases/download/${tag}/${asset.name}`
    )
      return null;
    urls[platform] = url.href;
  }
  return {
    version: version.join('.'),
    urls,
    notes: `https://github.com/KRPCT/InkStream/releases/tag/${tag}`,
  };
}

async function refreshRelease() {
  const controller = new globalThis.AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 4500);
  try {
    const response = await globalThis.fetch(
      'https://api.github.com/repos/KRPCT/InkStream/releases/latest',
      {
        signal: controller.signal,
        credentials: 'omit',
        headers: { Accept: 'application/vnd.github+json' },
      },
    );
    if (!response.ok) return;
    const release = trustedRelease(await response.json());
    if (!release) return;
    for (const element of document.querySelectorAll('[data-release-version]')) {
      element.textContent = release.version;
    }
    for (const element of document.querySelectorAll('[data-download]')) {
      const url = release.urls[element.dataset.download];
      if (url) element.href = url;
    }
    for (const element of document.querySelectorAll('[data-release-notes]'))
      element.href = release.notes;
    const structuredData = document.querySelector('#software-data');
    if (structuredData) {
      const data = JSON.parse(structuredData.textContent);
      data.softwareVersion = release.version;
      structuredData.textContent = JSON.stringify(data);
    }
  } catch {
    // The bundled stable release remains usable when GitHub is unavailable or data is invalid.
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

void refreshRelease();
