'use strict';

/* global STATUS */

const MIN_PROGRESS = 0.01;
const TIMEOUT_500_MS = 500;
const DEFAULT_REQUEST_TIMEOUT_IN_SECONDS = 30;
const FLARESOLVERR_REQUEST_TIMEOUT_IN_SECONDS = 120;
const HTTP_OK_STATUS = 200;
const HTTP_MULTIPLE_CHOICES_STATUS = 300;
const HTTP_ERROR_STATUS = 400;
const HTTP_SERVER_ERROR_STATUS = 500;
const HTTP_STATUS_UPPER_BOUND = 600;
const HTTP_FORBIDDEN_STATUS = 403;
const HTTP_TOO_MANY_REQUESTS_STATUS = 429;
const HTTP_SERVICE_UNAVAILABLE_STATUS = 503;
const DEFAULT_REQUEST_DELAY_IN_SECONDS = 1;
const FAVICON_TAB_LOAD_TIMEOUT_IN_MS = 15000;
const FAVICON_TAB_CONCURRENCY = 2;
const MILLISECONDS_PER_SECOND = 1000;
const FLARESOLVERR_MAX_CONCURRENT_REQUESTS = 2;
const REQUEST_TIMEOUT_WATCHDOG_PREFIX = 'bookmarks-organizer-request-timeout-';
const LEGACY_FLARESOLVERR_WATCHDOG_PREFIX = 'bookmarks-organizer-flaresolverr-timeout-';
const ACTIVE_CHECK_SESSION_KEY = 'bookmarksOrganizerActiveCheckId';
const FLARESOLVERR_JSON_ERRORS_SESSION_KEY = 'bookmarksOrganizerFlareSolverrJsonErrors';
const STOP_TASK_DRAIN_TIMEOUT_IN_MS = 500;
const NETWORK_ERROR_EVENT_WAIT_IN_MS = 250;
const RETRY_DELAY_MIN_IN_MS = 30000;
const RETRY_DELAY_MAX_IN_MS = 60000;
const RATE_LIMIT_RETRY_DELAY_IN_MS = 5000;
const FLARESOLVERR_JSON_PARSE_RETRY_DELAY_IN_MS = 5000;
const INTERLEAVE_POSITION_OFFSET = 0.5;
const CHALLENGE_BODY_MAX_LENGTH = 65536;
const CLOUDFLARE_CHALLENGE_MARKERS = /cf-mitigated|__cf_chl_rt_tk|__cf_chl_|cf-chl/i;
/* Disabled: protected-domain detection caused unconditional FlareSolverr requests.
const KNOWN_PROTECTED_DOMAINS = [
  'archiveofourown.org',
  'discord.com',
  'facebook.com',
  'fandom.com',
  'instagram.com',
  'medium.com',
  'quora.com',
  'reddit.com',
  'twitter.com',
  'x.com'
];
*/
const YIELD_INTERVAL = 100;
const UI_PAGE = 'html/ui.html';

/**
 * @exports bookmarksorganizer
 */
const bookmarksorganizer = {
  /**
   * Limits the number of queried bookmarks. A value of 0 disables the limit. It's only there for debugging purposes.
   * In production, it's always 0, there is no user setting.
   *
   * @type {int}
   */
  LIMIT : 0,

  /**
   * Max attempts to connect to a URL. It's always 2, there is no user setting (yet).
   *
   * @type {int}
   */
  MAX_ATTEMPTS : 2,

  /**
   * Timeout for reaching a server in milliseconds. It defaults to 15 seconds and can be changed in the add-on's settings.
   *
   * @type {int}
   */
  DIRECT_REQUEST_TIMEOUT_IN_MS : 30000,

  /** @type {int} */
  FLARESOLVERR_REQUEST_TIMEOUT_IN_MS : FLARESOLVERR_REQUEST_TIMEOUT_IN_SECONDS * MILLISECONDS_PER_SECOND,

  /**
   * Minimum time between the start of network requests in milliseconds.
   *
   * @type {int}
   */
  REQUEST_DELAY_IN_MS : 1000,

  /**
   * Never process more than QUEUE_SIZE bookmarks at the same time. Default is 2.
   *
   * @type {int}
   */
  QUEUE_SIZE : 2,

  /**
   * Maximum number of concurrent network requests. It defaults to QUEUE_SIZE and can be changed in the add-on's settings.
   *
   * @type {int}
   */
  maxConcurrentRequests : 2,

  /**
   * Whether link checks should be sent through a configured FlareSolverr instance.
   *
   * @type {boolean}
   */
  useFlareSolverr : false,

  /** @type {boolean} */
  showRequestResults : false,

  /** @type {boolean} */
  loadFavicons : false,

  /** @type {Set<number>} */
  activeFaviconTabIds : new Set(),

  /** @type {?string} */
  faviconLoadingCheckId : null,

  /** @type {boolean} */
  shuffleUrls : false,

  /** @type {boolean} */
  useCloudflareDomainRouting : true,

  /** @type {boolean} */
  directFallbackFlareSolverrJsonError : false,

  /** @type {Set<string>} */
  cloudflareDomains : new Set(),

  /** @type {Set<string>} */
  directOnlyDomains : new Set(),

  /** @type {Promise<void>} */
  cloudflareDomainStorageQueue : Promise.resolve(),

  /**
   * FlareSolverr API endpoint.
   *
   * @type {string}
   */
  flareSolverrUrl : 'http://localhost:8191/v1',

  /** @type {{direct: Promise<void>, flareSolverr: Promise<void>}} */
  requestStartQueues : { direct : Promise.resolve(), flareSolverr : Promise.resolve() },

  /** @type {{direct: number, flareSolverr: number}} */
  lastRequestStartedAt : { direct : 0, flareSolverr : 0 },

  /**
   * Whether the internal skip list should be used or not. It's always true, there is no user setting (yet).
   *
   * @type {boolean}
   */
  USE_SKIP_LIST : true,

  /**
   * Enables or disables the debug mode. It defaults to false and can be enabled in the add-on's settings.
   *
   * @type {boolean}
   */
  debugEnabled : false,

  /**
   * Disables confirmation messages. It defaults to false and can be changed in the add-on's settings.
   *
   * @type {boolean}
   */
  disableConfirmations : false,

  /**
   * Internal variable. It's only true while a check is running.
   *
   * @type {boolean}
   */
  inProgress : false,

  /** @type {?string} */
  checkId : null,

  /** @type {int} */
  checkSequence : 0,

  /** @type {int} */
  bookmarkCountUpdateSequence : 0,

  /** @type {boolean} */
  stopRequested : false,

  /** @type {boolean} */
  checkFinalized : false,

  /** @type {Set<AbortController>} */
  activeControllers : new Set(),

  /** @type {Map<string, number>} */
  activeDirectRequestUrls : new Map(),

  /** @type {Map<string, string>} */
  directRequestNetworkErrors : new Map(),

  /** @type {number} */
  activeFlareSolverrRequests : 0,

  /** @type {Array<{resolve: Function, cancelled: boolean}>} */
  flareSolverrWaiters : [],

  /** @type {number} */
  activeDirectRequests : 0,

  /** @type {Array<{resolve: Function, cancelled: boolean}>} */
  directRequestWaiters : [],

  /** @type {Array<number>} */
  whitelist : [],

  /** @type {Promise<void>} */
  stopPromise : Promise.resolve(),

  /** @type {Function|null} */
  resolveStop : null,

  /** @type {Set<Function>} */
  activeRequestCancellations : new Set(),

  /** @type {Map<string, {deadline: number, expire: Function}>} */
  flareSolverrTimeoutWatchdogs : new Map(),

  /** @type {number} */
  flareSolverrRequestSequence : 0,

  /** @type {number} */
  lastPartialResultsCount : -1,

  /**
   * Internal variable. The index of the bookmark being checked.
   *
   * @type {int}
   */
  internalCounter : 0,

  /**
   * The number of total bookmarks.
   *
   * @type {int}
   */
  totalBookmarks : 0,

  /**
   * The number of already checked bookmarks.
   *
   * @type {int}
   */
  checkedBookmarks : 0,

  /** @type {Set<string>} */
  checkedBookmarkIds : new Set(),

  /** @type {Map<string, bookmarks.BookmarkTreeNode>} */
  activeBookmarkChecks : new Map(),

  /**
   * The number of found errors.
   *
   * @type {int}
   */
  bookmarkErrors : 0,

  /**
   * The number of found warnings (e.g. redirects).
   *
   * @type {int}
   */
  bookmarkWarnings : 0,

  /**
   * An array containing all bookmarks.
   *
   * @type {Array.<bookmarks.BookmarkTreeNode>}
   */
  collectedBookmarks : [],

  /**
   * An array of bookmarks with errors or warnings.
   *
   * @type {Array.<bookmarks.BookmarkTreeNode>}
   */
  bookmarksResult : [],

  /**
   * Additional data stored for bookmarks. In current version it only contains the full bookmark path.
   *
   * @type {Array.<Object>}
   */
  additionalData : [],

  /**
   * An array with debugging data about bookmark requests. Only used if debug mode is enabled.
   *
   * @type {Array.<Object>}
   */
  debug : [],

  /** @type {Array<{url: string, responseText: string}>} */
  flareSolverrJsonErrors : [],

  /**
   * State variable, contains the currently selected mode (broken-bookmarks, duplicates, empty-names).
   *
   * @type {string}
   */
  mode : 'broken-bookmarks',

  /**
   * State variable, contains the currently selected type (all, errors, warnings).
   *
   * @type {string}
   */
  type : 'all',

  /**
   * An array of url patterns which should be ignored while checking for broken bookmarks. Please only add patterns
   * if there are known problems and add a comment with the GitHub issue.
   *
   * @type {Array.<string>}
   *
   */
  ignoreForBrokenBookmarks : [
    /* eslint-disable no-useless-escape, line-comment-position, no-inline-comments */
    '^https?:\/\/groups.google.com/group/', // issue #25
    '^https?:\/\/accounts-static.cdn.mozilla.net', // issue #76
    '^https?:\/\/accounts.firefox.com', // issue #76
    '^https?:\/\/addons.cdn.mozilla.net', // issue #76
    '^https?:\/\/addons.mozilla.org', // issue #76
    '^https?:\/\/api.accounts.firefox.com', // issue #76
    '^https?:\/\/content.cdn.mozilla.net', // issue #76
    '^https?:\/\/discovery.addons.mozilla.org', // issue #76
    '^https?:\/\/install.mozilla.org', // issue #76
    '^https?:\/\/oauth.accounts.firefox.com', // issue #76
    '^https?:\/\/profile.accounts.firefox.com', // issue #76
    '^https?:\/\/support.mozilla.org', // issue #76
    '^https?:\/\/sync.services.mozilla.com', // issue #76
    '^https?:\/\/www.facebook.com' // issue #213
    /* eslint-enable no-useless-escape, line-comment-position, no-inline-comments */
  ],

  /**
   * Fired when the permission to access all website data is granted.
   *
   * @param {permissions.Permissions} permissions - collection of granted permissions
   *
   * @returns {void}
   */
  onPermissionGranted (permissions) {
    if (permissions.origins.includes('<all_urls>')) {
      browser.runtime.sendMessage({
        message : 'permission-granted',
        has_bookmarks : bookmarksorganizer.totalBookmarks > 0
      });
    }
  },

  /**
   * Fired when the permission to access all website data is revoked.
   *
   * @param {permissions.Permissions} permissions - collection of revoked permissions
   *
   * @returns {void}
   */
  onPermissionRevoked (permissions) {
    if (permissions.origins.includes('<all_urls>')) {
      browser.runtime.sendMessage({
        message : 'permission-revoked',
        has_bookmarks : bookmarksorganizer.totalBookmarks > 0
      });
    }
  },

  /**
   * Fired when a bookmark or a bookmark folder is created.
   *
   * @param {int} id - id of the bookmark that was created
   * @param {bookmarks.BookmarkTreeNode} bookmark - bookmark object containing the data of the new bookmark
   *
   * @returns {void}
   */
  onBookmarkCreated (id, bookmark) {
    bookmarksorganizer.collectAllBookmarks(bookmark, true);

    // execute check if a bookmarks check is already in progress
    if (bookmarksorganizer.inProgress && !bookmarksorganizer.stopRequested) {
      bookmarksorganizer.checkForBrokenBookmark(bookmark, bookmarksorganizer.mode, bookmarksorganizer.type);
    }
  },

  /**
   * Fired when a bookmark or a bookmark folder is changed.
   *
   * @param {int} id - id of the bookmark that was changed
   * @param {bookmarks.BookmarkTreeNode} bookmark - bookmark object containing the new data of the bookmark
   *
   * @returns {void}
   */
  onBookmarkChanged (id, bookmark) {
    // update bookmark in array with all bookmarks
    const idx = bookmarksorganizer.collectedBookmarks.findIndex((obj) => obj.id === id);

    if (idx > -1) {
      if (bookmark.title || bookmark.title === '') {
        bookmarksorganizer.collectedBookmarks[idx].title = bookmark.title;
      }

      if (bookmark.url) {
        bookmarksorganizer.collectedBookmarks[idx].url = bookmark.url;
      }
    }
    else {
      bookmarksorganizer.collectedBookmarks.push(bookmark);
    }
  },

  /**
   * Fired when a bookmark or a bookmark folder is removed.
   *
   * @returns {Promise<void>} - resolves after the bookmark count is updated
   */
  async onBookmarkRemoved () {
    await bookmarksorganizer.initBookmarkCount(false);

    browser.runtime.sendMessage({
      message : 'total-bookmarks-changed',
      total_bookmarks : bookmarksorganizer.totalBookmarks
    });
  },

  /**
   * Fired whenever the user changes the input, after the user has started interacting with the add-on by entering
   * its keyword in the address bar and then pressing the space key.
   *
   * @param {string} input - user input in the address bar, not including the add-on's keyword itself or the space
   *                 after the keyword<br /><br />
   *                 <strong>Supported values:</strong> duplicates, empty-names, errors, organizer, redirects
   * @param {function} suggest - a callback function that the event listener can call to supply suggestions for the
   *                   address bar's drop-down list
   *
   * @returns {void}
   */
  showOmniboxSuggestions (input, suggest) {
    const availableCommands = ['duplicates', 'empty-names', 'errors', 'organizer', 'redirects'];
    const suggestions = [];

    for (const command of availableCommands) {
      if (command.indexOf(input) !== -1) {
        suggestions.push({
          content : command,
          description : browser.i18n.getMessage('omnibox_command_check_' + command.replace('-', '_'))
        });
      }

      if (suggestions.length === 0) {
        suggestions.push({
          content : 'organizer',
          description : browser.i18n.getMessage('omnibox_command_check_organizer')
        });
      }
    }

    suggest(suggestions);
  },

  /**
   * Fired when the user has selected one of the suggestions the add-on has added to the address bar's drop-down list.
   *
   * @param {string} input - this is the value that the user selected
   *
   * @returns {void}
   */
  callOmniboxAction (input) {
    bookmarksorganizer.openUserInterfaceInCurrentTab();

    // issue #74: set timeout to prevent "receiving end does not exist" error
    setTimeout(() => {
      switch (input) {
        case 'errors':
          bookmarksorganizer.execute('broken-bookmarks', 'errors');
          break;
        case 'redirects':
          bookmarksorganizer.execute('broken-bookmarks', 'warnings');
          break;
        case 'duplicates':
          bookmarksorganizer.execute('duplicates', 'all');
          break;
        case 'empty-names':
          bookmarksorganizer.execute('empty-names', 'all');
          break;
        case 'organizer':
        default:
          bookmarksorganizer.openUserInterfaceInCurrentTab();
      }
    }, TIMEOUT_500_MS);
  },

  /**
   * Fired when the toolbar icon is clicked. This method is used to open the user interface in a new tab or to switch
   * to the tab with the user interface if the user interface is already opened.
   *
   * @returns {void}
   */
  openUserInterface () {
    const url = browser.runtime.getURL(UI_PAGE);

    browser.tabs.query({}, (tabs) => {
      let tabId = null;

      for (const tab of tabs) {
        if (tab.url === url) {
          tabId = tab.id;
          break;
        }
      }

      if (tabId) {
        browser.tabs.update(tabId, { active : true });
      }
      else {
        browser.tabs.create({ url });
      }
    });
  },

  /**
   * This method is used to open the user interface in the current tab. It's used for the omnibox suggestions.
   *
   * @returns {void}
   */
  openUserInterfaceInCurrentTab () {
    browser.tabs.update(null, { url : browser.runtime.getURL(UI_PAGE) });
  },

  /**
   * Fired when a message is sent from the UI script to the background script.
   *
   * @param {Object} response - contains the response from the UI script
   *
   * @returns {void}
   */
  async handleResponse (response) {
    if (response.message === 'check-permission') {
      const granted = await browser.permissions.contains({ origins : ['<all_urls>'] });
      await bookmarksorganizer.initBookmarkCount();

      browser.runtime.sendMessage({
        message : granted ? 'permission-granted' : 'permission-revoked',
        has_bookmarks : bookmarksorganizer.totalBookmarks > 0
      });
    }
    else if (response.message === 'count') {
      bookmarksorganizer.initBookmarkCount();
    }
    else if (response.message === 'execute') {
      // reset internal state since background page is no longer persistent in MV3
      if (bookmarksorganizer.totalBookmarks === 0) {
        bookmarksorganizer.inProgress = false;
        await bookmarksorganizer.initBookmarkCount();
      }

      if (!bookmarksorganizer.inProgress) {
        bookmarksorganizer.execute(response.mode, 'all');
      }
    }
    else if (response.message === 'stop' && bookmarksorganizer.inProgress) {
      bookmarksorganizer.stopRequested = true;
      bookmarksorganizer.resolveStop();
      bookmarksorganizer.flareSolverrWaiters.forEach((waiter) => {
        waiter.cancelled = true;
        waiter.resolve(false);
      });
      bookmarksorganizer.flareSolverrWaiters = [];
      bookmarksorganizer.directRequestWaiters.forEach((waiter) => {
        waiter.cancelled = true;
        waiter.resolve(false);
      });
      bookmarksorganizer.directRequestWaiters = [];
      bookmarksorganizer.activeRequestCancellations.forEach((cancelRequest) => cancelRequest());
      bookmarksorganizer.activeControllers.forEach((controller) => controller.abort());
      await bookmarksorganizer.closeActiveFaviconTabs();

      // Finalize the visible results directly from the stop message handler.
      // Do not rely on every in-flight request promise unwinding: a stalled
      // FlareSolverr fetch or response body must not keep the UI in checking state.
      if (bookmarksorganizer.mode === 'broken-bookmarks') {
        await bookmarksorganizer.finishCheck(bookmarksorganizer.mode);
      }
    }
    else if (response.message === 'clear-cloudflare-domains') {
      await bookmarksorganizer.clearCloudflareDomains();
    }
    else if (response.message === 'edit') {
      await browser.bookmarks.update(response.bookmarkId, {
        title : response.title,
        url : response.url
      });

      if (response.mode === 'duplicate') {
        browser.runtime.sendMessage({
          message : 'update-listitem',
          bookmarkId : response.bookmarkId,
          title : response.title,
          path : bookmarksorganizer.additionalData[response.bookmarkId].path,
          mode : response.mode
        });
      }
      else {
        const bookmarks = await browser.bookmarks.get(response.bookmarkId);
        browser.runtime.sendMessage({
          message : 'update-listitem',
          bookmarkId : response.bookmarkId,
          bookmark : bookmarks[0],
          mode : response.mode
        });
      }
    }
    else if (response.message === 'remove') {
      browser.bookmarks.remove(response.bookmarkId);
    }
    else if (response.message === 'repair-redirect') {
      browser.bookmarks.update(response.bookmarkId, { url : response.newUrl });
    }
    else if (response.message === 'ignore') {
      bookmarksorganizer.addToWhitelist(response.bookmarkId);
    }
  },

  /**
   * This method is used to start counting the number of bookmarks and to send the number of total bookmarks to the
   * UI script when finished.
   *
   * @param {boolean} notify - whether to send the initial total-bookmarks message
   *
   * @returns {Promise<void>} - resolves after the bookmark count is updated
   */
  async initBookmarkCount (notify = true) {
    const updateSequence = ++bookmarksorganizer.bookmarkCountUpdateSequence;
    const bookmarks = await browser.bookmarks.getTree();

    const collectedBookmarks = [];
    let totalBookmarks = 0;
    const collectBookmarkTree = (bookmark) => {
      if (bookmark.type === 'separator') {
        return;
      }

      collectedBookmarks.push(bookmark);
      if (bookmark.url) {
        totalBookmarks++;
      }

      if (bookmark.children) {
        bookmark.children.forEach(collectBookmarkTree);
      }
    };
    collectBookmarkTree(bookmarks[0]);

    if (updateSequence !== bookmarksorganizer.bookmarkCountUpdateSequence) {
      return;
    }

    bookmarksorganizer.totalBookmarks = totalBookmarks;
    if (!bookmarksorganizer.inProgress) {
      bookmarksorganizer.collectedBookmarks = collectedBookmarks;
    }
    await browser.storage.session.set({ totalBookmarks : totalBookmarks });

    if (notify) {
      browser.runtime.sendMessage({
        message : 'total-bookmarks',
        total_bookmarks : totalBookmarks
      });
    }
  },

  /**
   * This method is the starting point for checking the bookmarks.
   *
   * @param {string} mode - The checking mode<br /><br />
   *                 <strong>Supported values:</strong> broken-bookmarks, duplicates, empty-names
   * @param {string} type - The requested type of results<br /><br />
   *                 <strong>Supported values:</strong> errors, warnings, all
   *
   * @returns {Promise<void>} - resolves when the bookmark check has finished
   */
  // eslint-disable-next-line complexity
  async execute (mode, type) {
    bookmarksorganizer.faviconLoadingCheckId = null;
    void bookmarksorganizer.closeActiveFaviconTabs();
    bookmarksorganizer.inProgress = true;
    bookmarksorganizer.stopRequested = false;
    bookmarksorganizer.checkFinalized = false;
    bookmarksorganizer.activeControllers.clear();
    bookmarksorganizer.activeDirectRequestUrls.clear();
    bookmarksorganizer.directRequestNetworkErrors.clear();
    bookmarksorganizer.stopPromise = new Promise((resolve) => {
      bookmarksorganizer.resolveStop = resolve;
    });
    bookmarksorganizer.activeFlareSolverrRequests = 0;
    bookmarksorganizer.flareSolverrWaiters = [];
    bookmarksorganizer.activeDirectRequests = 0;
    bookmarksorganizer.directRequestWaiters = [];
    bookmarksorganizer.activeRequestCancellations.clear();
    bookmarksorganizer.internalCounter = 0;
    bookmarksorganizer.checkedBookmarks = 0;
    bookmarksorganizer.checkedBookmarkIds = new Set();
    bookmarksorganizer.activeBookmarkChecks = new Map();
    bookmarksorganizer.directOnlyDomains = new Set();
    bookmarksorganizer.bookmarkErrors = 0;
    bookmarksorganizer.bookmarkWarnings = 0;
    bookmarksorganizer.bookmarksResult = [];
    bookmarksorganizer.lastPartialResultsCount = -1;
    bookmarksorganizer.additionalData = [];
    bookmarksorganizer.debug = [];
    bookmarksorganizer.flareSolverrJsonErrors = [];
    bookmarksorganizer.mode = mode;
    bookmarksorganizer.type = type;
    bookmarksorganizer.checkId = `${Date.now()}-${++bookmarksorganizer.checkSequence}`;
    bookmarksorganizer.faviconLoadingCheckId = bookmarksorganizer.checkId;

    try {
      await browser.storage.session.remove(FLARESOLVERR_JSON_ERRORS_SESSION_KEY);
    }
    catch (error) {
      // eslint-disable-next-line no-console
      console.error('Unable to clear previous FlareSolverr JSON error details', error);
    }

    try {
      if (mode === 'broken-bookmarks') {
        await browser.storage.session.set({ [ACTIVE_CHECK_SESSION_KEY] : bookmarksorganizer.checkId });
      }
      else {
        await browser.storage.session.remove(ACTIVE_CHECK_SESSION_KEY);
      }
    }
    catch (error) {
      // The check can proceed without restart recovery if session storage is unavailable.
    }

    browser.runtime.sendMessage({ message : 'started', checkId : bookmarksorganizer.checkId });

    const options = await browser.storage.local.get({
      debugEnabled : false,
      disableConfirmations : false,
      whitelist : [],
      maxConcurrentRequests : bookmarksorganizer.QUEUE_SIZE,
      cloudflare : [],
      useCloudflareDomainRouting : true,
      directFallbackFlareSolverrJsonError : false,
      directRequestTimeout : null,
      flareSolverrRequestTimeout : FLARESOLVERR_REQUEST_TIMEOUT_IN_SECONDS,
      requestTimeout : null,
      requestTimeoutBeforeFlareSolverr : null,
      requestDelay : DEFAULT_REQUEST_DELAY_IN_SECONDS,
      useFlareSolverr : false,
      flareSolverrUrl : 'http://localhost:8191/v1',
      showFlareSolverrResult : true,
      shuffleUrls : true,
      loadFavicons : false
    });

    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.debugEnabled = options.debugEnabled;
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.disableConfirmations = options.disableConfirmations;
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.whitelist = options.whitelist;
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.cloudflareDomains = new Set(bookmarksorganizer.normalizeCloudflareDomains(options.cloudflare));
    const parsedMaxConcurrentRequests = parseInt(options.maxConcurrentRequests);
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.maxConcurrentRequests = Number.isInteger(parsedMaxConcurrentRequests) && parsedMaxConcurrentRequests > 0 ? parsedMaxConcurrentRequests : bookmarksorganizer.QUEUE_SIZE;

    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.useFlareSolverr = options.useFlareSolverr === true;
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.useCloudflareDomainRouting = bookmarksorganizer.useFlareSolverr && options.useCloudflareDomainRouting !== false;
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.directFallbackFlareSolverrJsonError = options.directFallbackFlareSolverrJsonError === true;
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.showRequestResults = options.showFlareSolverrResult === true;
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.shuffleUrls = options.shuffleUrls === true;
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.loadFavicons = options.loadFavicons === true;
    try {
      const flareSolverrUrl = new URL(options.flareSolverrUrl);
      if ((flareSolverrUrl.protocol === 'http:' || flareSolverrUrl.protocol === 'https:') && !flareSolverrUrl.username && !flareSolverrUrl.password) {
        if (flareSolverrUrl.pathname === '/') {
          flareSolverrUrl.pathname = '/v1';
        }

        // eslint-disable-next-line require-atomic-updates
        bookmarksorganizer.flareSolverrUrl = flareSolverrUrl.href.replace(/\/$/, '');
      }
    }
    catch (error) {
      // Keep the default endpoint when the stored value is invalid.
    }

    let directRequestTimeout = parseInt(options.directRequestTimeout);
    if (!Number.isInteger(directRequestTimeout) || directRequestTimeout <= 0) {
      const legacyTimeout = parseInt(options.requestTimeout);
      const legacyDirectTimeout = parseInt(options.requestTimeoutBeforeFlareSolverr);
      if (Number.isInteger(legacyDirectTimeout) && legacyDirectTimeout > 0) {
        directRequestTimeout = legacyDirectTimeout;
      }
      else if (!bookmarksorganizer.useFlareSolverr && Number.isInteger(legacyTimeout) && legacyTimeout > 0) {
        directRequestTimeout = legacyTimeout;
      }
      else {
        directRequestTimeout = DEFAULT_REQUEST_TIMEOUT_IN_SECONDS;
      }
    }
    const parsedFlareSolverrRequestTimeout = parseInt(options.flareSolverrRequestTimeout);
    let flareSolverrRequestTimeout = FLARESOLVERR_REQUEST_TIMEOUT_IN_SECONDS;
    if (Number.isInteger(parsedFlareSolverrRequestTimeout) && parsedFlareSolverrRequestTimeout > 0) {
      flareSolverrRequestTimeout = parsedFlareSolverrRequestTimeout;
    }

    await browser.storage.local.set({
      directRequestTimeout : directRequestTimeout,
      flareSolverrRequestTimeout : flareSolverrRequestTimeout
    });

    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.DIRECT_REQUEST_TIMEOUT_IN_MS = directRequestTimeout * MILLISECONDS_PER_SECOND;
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.FLARESOLVERR_REQUEST_TIMEOUT_IN_MS = flareSolverrRequestTimeout * MILLISECONDS_PER_SECOND;

    const parsedRequestDelay = parseInt(options.requestDelay);
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.REQUEST_DELAY_IN_MS = (Number.isInteger(parsedRequestDelay) && parsedRequestDelay >= 0 ? parsedRequestDelay : DEFAULT_REQUEST_DELAY_IN_SECONDS) * MILLISECONDS_PER_SECOND;
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.requestStartQueues = { direct : Promise.resolve(), flareSolverr : Promise.resolve() };
    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.lastRequestStartedAt = { direct : 0, flareSolverr : 0 };

    if (bookmarksorganizer.loadFavicons) {
      void bookmarksorganizer.loadBookmarkFavicons(bookmarksorganizer.collectedBookmarks, bookmarksorganizer.checkId);
    }

    switch (mode) {
      case 'broken-bookmarks':
        await bookmarksorganizer.processBookmarks(mode, type);
        break;
      case 'duplicates':
        const bookmarks = await browser.bookmarks.getTree();

        bookmarksorganizer.getBookmarkPath(bookmarks[0], []);

        for (let i = 0; i < bookmarksorganizer.collectedBookmarks.length; i++) {
          if (bookmarksorganizer.stopRequested) {
            break;
          }

          const bookmark = bookmarksorganizer.collectedBookmarks[i];
          bookmarksorganizer.checkBookmarkAndAssignPath(bookmark);

          if ((i + 1) % YIELD_INTERVAL === 0) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => {
              setTimeout(resolve, 0);
            });
          }
        }

        bookmarksorganizer.checkForDuplicates();
        break;
      case 'empty-names':
        for (let i = 0; i < bookmarksorganizer.collectedBookmarks.length; i++) {
          if (bookmarksorganizer.stopRequested) {
            break;
          }

          const bookmark = bookmarksorganizer.collectedBookmarks[i];
          bookmarksorganizer.checkForEmptyName(bookmark);

          if ((i + 1) % YIELD_INTERVAL === 0) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => {
              setTimeout(resolve, 0);
            });
          }
        }
        break;
      default:
        // do nothing
    }

    if (mode !== 'duplicates') {
      await bookmarksorganizer.finishCheck(mode);
    }
  },

  /**
   * Loads bookmark pages in inactive tabs so Firefox can cache their favicons.
   *
   * @param {Array.<bookmarks.BookmarkTreeNode>} bookmarks - the bookmarks to visit
   * @param {string} checkId - the current check identifier
   *
   * @returns {Promise<void>} - resolves after favicon loading has stopped
   */
  async loadBookmarkFavicons (bookmarks, checkId) {
    const urls = [
      ...new Set(
        bookmarks
          .filter((bookmark) => bookmark.url)
          .map((bookmark) => bookmark.url)
          .filter((url) => {
            try {
              const parsedUrl = new URL(url);

              return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
            }
            catch (error) {
              return false;
            }
          })
      )
    ];
    let nextIndex = 0;

    const worker = async () => {
      while (!bookmarksorganizer.stopRequested && bookmarksorganizer.faviconLoadingCheckId === checkId) {
        const url = urls[nextIndex++];
        if (!url) {
          return;
        }

        // eslint-disable-next-line no-await-in-loop
        await bookmarksorganizer.loadBookmarkFavicon(url, checkId);
      }
    };

    try {
      await Promise.all(Array.from(
        { length : Math.min(FAVICON_TAB_CONCURRENCY, urls.length) },
        () => worker()
      ));
    }
    catch (error) {
      bookmarksorganizer.logFaviconLoadingError('Unable to load bookmark favicons', error);
    }
  },

  /**
   * Opens and closes an inactive tab after its page has loaded or timed out.
   *
   * @param {string} url - the bookmark URL to visit
   * @param {string} checkId - the current check identifier
   *
   * @returns {Promise<void>} - resolves after the tab is closed
   */
  async loadBookmarkFavicon (url, checkId) {
    let tab = null;
    try {
      tab = await browser.tabs.create({ url : url, active : false });
    }
    catch (error) {
      bookmarksorganizer.logFaviconLoadingError(`Unable to open bookmark for favicon loading: ${url}`, error);

      return;
    }

    if (!Number.isInteger(tab.id)) {
      bookmarksorganizer.logFaviconLoadingError(`Firefox did not return a tab ID for favicon loading: ${url}`, null);

      return;
    }

    const tabId = tab.id;
    if (bookmarksorganizer.stopRequested || bookmarksorganizer.faviconLoadingCheckId !== checkId) {
      try {
        await browser.tabs.remove(tabId);
      }
      catch (error) {
        bookmarksorganizer.logFaviconLoadingError(`Unable to close stale favicon-loading tab for ${url}`, error);
      }

      return;
    }

    bookmarksorganizer.activeFaviconTabIds.add(tabId);

    let resolveLoading = null;
    let timeoutId = null;
    let onUpdated = null;
    let onRemoved = null;
    const loadingFinished = new Promise((resolve) => {
      resolveLoading = resolve;
    });
    let finished = false;
    const cleanup = async (removeTab = true) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      bookmarksorganizer.activeFaviconTabIds.delete(tabId);

      if (removeTab) {
        try {
          await browser.tabs.remove(tabId);
        }
        catch (error) {
          bookmarksorganizer.logFaviconLoadingError(`Unable to close favicon-loading tab for ${url}`, error);
        }
      }

      resolveLoading();
    };
    onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        void cleanup();
      }
    };
    onRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        void cleanup(false);
      }
    };
    timeoutId = setTimeout(() => {
      void cleanup();
    }, FAVICON_TAB_LOAD_TIMEOUT_IN_MS);

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);

    if (tab.status === 'complete') {
      await cleanup();
    }
    else {
      try {
        const currentTab = await browser.tabs.get(tabId);
        if (currentTab.status === 'complete') {
          await cleanup();
        }
      }
      catch (error) {
        if (!finished) {
          bookmarksorganizer.logFaviconLoadingError(`Unable to check favicon-loading tab for ${url}`, error);
          await cleanup();
        }
      }
    }

    await loadingFinished;
  },

  /**
   * Closes any tabs currently being used to load bookmark favicons.
   *
   * @returns {Promise<void>} - resolves after active favicon tabs are closed
   */
  async closeActiveFaviconTabs () {
    const activeTabIds = [...bookmarksorganizer.activeFaviconTabIds];
    await Promise.all(activeTabIds.map(async (tabId) => {
      try {
        await browser.tabs.remove(tabId);
      }
      catch (error) {
        bookmarksorganizer.logFaviconLoadingError(`Unable to close favicon-loading tab ${tabId}`, error);
      }
    }));
  },

  /**
   * Reports errors encountered while loading bookmark favicons.
   *
   * @param {string} message - the error message
   * @param {?Error} error - the error details, if available
   *
   * @returns {void}
   */
  logFaviconLoadingError (message, error) {
    // eslint-disable-next-line no-console
    console.error(message, error);
  },

  /**
   * Get the full path of all bookmarks. It's only used for the duplicates mode.
   *
   * @param {Array.<bookmarks.BookmarkTreeNode>} bookmark - a tree of bookmarks
   * @param {Array<string>} path - the path or a part of the path of the bookmark
   *
   * @returns {Array.<Object>} - An array with the full path of all bookmarks
   */
  getBookmarkPath (bookmark, path) {
    if (bookmark.title) {
      path.push(bookmark.title);
    }

    if (bookmark.children) {
      for (const childNode of bookmark.children) {
        bookmarksorganizer.getBookmarkPath(childNode, path);
      }
    }
    else {
      if (!bookmarksorganizer.additionalData[bookmark.id]) {
        bookmarksorganizer.additionalData[bookmark.id] = {};
      }

      bookmarksorganizer.additionalData[bookmark.id].path = path.slice(0, -1);
    }

    path.pop();

    return bookmarksorganizer.additionalData;
  },

  /**
   * This method is used to check for broken bookmarks, called by processBookmarks().
   *
   * @param {bookmarks.BookmarkTreeNode} bookmark - a single bookmark
   * @param {string} mode - The checking mode<br /><br />
   *                 <strong>Supported values:</strong> broken-bookmarks, duplicates, empty-names
   * @param {string} type - The requested type of results<br /><br />
   *                 <strong>Supported values:</strong> errors, warnings, all
   *
   * @returns {void}
   */
  async checkForBrokenBookmark (bookmark, mode, type) {
    if (bookmark.url) {
      if (bookmarksorganizer.LIMIT > 0 && bookmarksorganizer.internalCounter === bookmarksorganizer.LIMIT) {
        return;
      }

      bookmarksorganizer.internalCounter++;

      if (bookmarksorganizer.USE_SKIP_LIST && bookmarksorganizer.ignoreForBrokenBookmarks.some((i) => new RegExp('\\b' + i + '\\b').test(bookmark.url))) {
        bookmarksorganizer.markBookmarkChecked(bookmark);

        return;
      }

      if (bookmarksorganizer.whitelist.includes(bookmark.id)) {
        bookmarksorganizer.markBookmarkChecked(bookmark);

        return;
      }

      if ((/^https?:\/\//).test(bookmark.url)) {
        bookmark.attempts = 0;

        const checkedBookmark = await bookmarksorganizer.checkHttpResponse(bookmark, 'HEAD');
        if (bookmarksorganizer.checkFinalized) {
          return;
        }
        bookmarksorganizer.markBookmarkChecked(bookmark);

        switch (checkedBookmark.status) {
          case STATUS.REDIRECT:
            if (type === 'all' || type === 'warnings') {
              bookmarksorganizer.bookmarkWarnings++;
              bookmarksorganizer.bookmarksResult.push(checkedBookmark);
            }
            break;
          case STATUS.NOT_FOUND:
            if (type === 'all' || type === 'errors') {
              bookmarksorganizer.bookmarkErrors++;
              bookmarksorganizer.bookmarksResult.push(checkedBookmark);
            }
            break;
          case STATUS.UNKNOWN:
          case STATUS.FETCH_ERROR:
          case STATUS.TIMEOUT:
            if (type === 'all' || type === 'errors') {
              bookmarksorganizer.bookmarksResult.push(checkedBookmark);
            }
            break;
          default:
            if (checkedBookmark.status >= HTTP_ERROR_STATUS && checkedBookmark.status < HTTP_STATUS_UPPER_BOUND && (type === 'all' || type === 'errors')) {
              bookmarksorganizer.bookmarksResult.push(checkedBookmark);
            }
        }

        bookmarksorganizer.updateProgressUi();
      }
      else {
        bookmarksorganizer.markBookmarkChecked(bookmark);
        bookmarksorganizer.updateProgressUi();
      }
    }
    else {
      bookmarksorganizer.bookmarksResult.push(bookmark);
    }
  },

  /**
   * Counts a bookmark once, even if its task later throws while reporting results.
   *
   * @param {bookmarks.BookmarkTreeNode} bookmark - the bookmark that completed checking
   * @returns {void}
   */
  markBookmarkChecked (bookmark) {
    if (!bookmarksorganizer.checkedBookmarkIds.has(bookmark.id)) {
      bookmarksorganizer.checkedBookmarkIds.add(bookmark.id);
      bookmarksorganizer.checkedBookmarks++;
    }
  },

  /**
   * This method sends a fetch request to check if a bookmark is broken or not, called by checkForBrokenBookmark().
   *
   * @param {bookmarks.BookmarkTreeNode} bookmark - a single bookmark
   * @param {string} method - HTTP method (HEAD initially; GET for fallback/retry; POST after FlareSolverr JSON parse failure)
   *
   * @returns {bookmarks.BookmarkTreeNode} - the bookmark object
   */
  // eslint-disable-next-line complexity, max-depth
  async checkHttpResponse (bookmark, method) {
    if (bookmarksorganizer.stopRequested) {
      // eslint-disable-next-line require-atomic-updates
      bookmark.status = STATUS.UNKNOWN;

      return bookmark;
    }

    bookmark.attempts++;

    let controller = null;
    let directSlotAcquired = false;

    try {
      if (bookmarksorganizer.stopRequested) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;

        return bookmark;
      }

      directSlotAcquired = await bookmarksorganizer.acquireDirectRequestSlot();
      if (!directSlotAcquired) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;

        return bookmark;
      }

      await bookmarksorganizer.waitForRequestDelay('direct');

      if (bookmarksorganizer.stopRequested) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;

        return bookmark;
      }

      controller = new AbortController();
      bookmarksorganizer.activeControllers.add(controller);
      const { signal } = controller;
      const requestUrl = bookmarksorganizer.normalizeRequestUrl(bookmark.url);
      const activeRequestsForUrl = bookmarksorganizer.activeDirectRequestUrls.get(requestUrl) || 0;
      if (activeRequestsForUrl === 0) {
        bookmarksorganizer.directRequestNetworkErrors.delete(requestUrl);
      }
      bookmarksorganizer.activeDirectRequestUrls.set(
        requestUrl,
        activeRequestsForUrl + 1
      );

      const { response, challenge } = await bookmarksorganizer.withRequestTimeout(() => (async () => {
        const directResponse = await fetch(bookmark.url, {
          cache : 'no-store',
          method : method,
          redirect : 'follow',
          signal : signal
        });

        return {
          response : directResponse,
          challenge : await bookmarksorganizer.isCloudflareChallengeResponse(directResponse)
        };
      })(), controller, bookmarksorganizer.DIRECT_REQUEST_TIMEOUT_IN_MS, true);
      const shouldRememberCloudflareDomain =
        bookmarksorganizer.useCloudflareDomainRouting &&
        bookmark.attempts === 1 &&
        response.status === HTTP_FORBIDDEN_STATUS &&
        challenge;
      if (bookmarksorganizer.showRequestResults) {
        if (response.status === HTTP_FORBIDDEN_STATUS && challenge && !bookmarksorganizer.useFlareSolverr) {
          // eslint-disable-next-line require-atomic-updates
          bookmark.directRequestResult = `HTTP ${response.status}, ${browser.i18n.getMessage('direct_cloudflare_blocked')}`;
        }
        else {
          // eslint-disable-next-line require-atomic-updates
          bookmark.directRequestResult = response.redirected && response.url !== bookmark.url ? browser.i18n.getMessage('redirect_result') : `HTTP ${response.status}`;
        }
      }
      controller.abort();
      bookmarksorganizer.releaseDirectRequestSlot();
      directSlotAcquired = false;
      if (shouldRememberCloudflareDomain) {
        await bookmarksorganizer.addCloudflareDomain(bookmark.url);
      }

      if (response.status === STATUS.NOT_FOUND) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.NOT_FOUND;
      }
      else if (response.redirected) {
        // redirect to identical url. That's weird but there are cases in the real world…
        if (bookmark.url === response.url) {
          bookmark.status = STATUS.OK;
        }
        // redirect to another url
        else {
          bookmark.status = STATUS.REDIRECT;
        }

        bookmark.newUrl = response.url;

        // preserve the hash for redirects (issue #24)
        if (bookmark.url.indexOf('#') !== -1) {
          bookmark.newUrl += bookmark.url.substring(bookmark.url.indexOf('#'));
        }
      }
      else {
        const { headers } = response;
        if (headers.has('Content-Length') && headers.get('Content-Length') === '0') {
          // eslint-disable-next-line require-atomic-updates
          bookmark.status = STATUS.EMPTY_BODY;
        }
        else {
          // eslint-disable-next-line require-atomic-updates
          bookmark.status = response.status === STATUS.NOT_FOUND ? STATUS.NOT_FOUND : response.status;
        }
      }

      if (response.status !== STATUS.NOT_FOUND && (challenge || response.status >= HTTP_ERROR_STATUS)) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;
      }

      const shouldUseFlareSolverr = bookmarksorganizer.useFlareSolverr &&
        !bookmarksorganizer.isDirectOnlyDomain(bookmark.url) &&
        response.status === HTTP_FORBIDDEN_STATUS &&
        challenge;
      if (shouldUseFlareSolverr && !bookmarksorganizer.stopRequested) {
        return bookmarksorganizer.checkFlareSolverrResponse(bookmark);
      }

      // Some servers reject HEAD even though the page is available through GET.
      // Treat this as a method fallback, not as a retry attempt.
      if (
        method === 'HEAD' &&
        response.status !== STATUS.NOT_FOUND &&
        ![HTTP_TOO_MANY_REQUESTS_STATUS, HTTP_SERVICE_UNAVAILABLE_STATUS].includes(response.status) &&
        (response.status >= HTTP_ERROR_STATUS || challenge) &&
        !bookmarksorganizer.stopRequested
      ) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.attempts--;

        return bookmarksorganizer.checkHttpResponse(bookmark, 'GET');
      }

      if (bookmarksorganizer.debugEnabled) {
        bookmarksorganizer.debug.push({
          bookmark : {
            id : bookmark.id,
            parentId : bookmark.parentId,
            title : bookmark.title,
            url : bookmark.url,
            status : bookmark.status
          },
          method : method,
          cause : 'server-response',
          response : {
            url : response.url,
            redirected : response.redirected,
            status : response.status
          }
        });
      }

      const retryable = response.status >= HTTP_SERVER_ERROR_STATUS || response.status === HTTP_FORBIDDEN_STATUS || response.status === HTTP_TOO_MANY_REQUESTS_STATUS || response.status === HTTP_SERVICE_UNAVAILABLE_STATUS || challenge;
      if (response.status !== STATUS.NOT_FOUND && retryable && !bookmarksorganizer.stopRequested && bookmark.attempts < bookmarksorganizer.MAX_ATTEMPTS) {
        if ([HTTP_TOO_MANY_REQUESTS_STATUS, HTTP_SERVICE_UNAVAILABLE_STATUS].includes(response.status)) {
          await bookmarksorganizer.waitBeforeRetry(RATE_LIMIT_RETRY_DELAY_IN_MS);
        }
        else {
          await bookmarksorganizer.waitBeforeRetry();
        }
        if (!bookmarksorganizer.stopRequested) {
          return bookmarksorganizer.checkHttpResponse(bookmark, 'GET');
        }
      }

      if (shouldUseFlareSolverr && !bookmarksorganizer.stopRequested) {
        return bookmarksorganizer.checkFlareSolverrResponse(bookmark);
      }
    }
    catch (error) {
      if (directSlotAcquired) {
        bookmarksorganizer.releaseDirectRequestSlot();
        directSlotAcquired = false;
      }
      if (bookmarksorganizer.stopRequested && error.name === 'AbortError') {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;

        return bookmark;
      }
      let cause = 'fetch-error';

      if (error.name === 'AbortError') {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;
        cause = 'timeout';
      }
      else {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.FETCH_ERROR;
      }
      let fetchErrorMessage = error.message;
      if (error.name !== 'AbortError') {
        const requestUrl = bookmarksorganizer.normalizeRequestUrl(bookmark.url);
        fetchErrorMessage = bookmarksorganizer.directRequestNetworkErrors.get(requestUrl) || error.message;
        if (fetchErrorMessage === error.message && error.message.toLowerCase().includes('networkerror')) {
          await new Promise((resolve) => {
            setTimeout(resolve, NETWORK_ERROR_EVENT_WAIT_IN_MS);
          });
          fetchErrorMessage = bookmarksorganizer.directRequestNetworkErrors.get(requestUrl) || error.message;
        }
      }
      if (bookmarksorganizer.showRequestResults) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.directRequestResult = error.name === 'AbortError' ? browser.i18n.getMessage('flaresolverr_timeout') : fetchErrorMessage;
      }

      if (bookmarksorganizer.debugEnabled) {
        bookmarksorganizer.debug.push({
          bookmark : {
            id : bookmark.id,
            parentId : bookmark.parentId,
            title : bookmark.title,
            url : bookmark.url,
            status : bookmark.status
          },
          method : method,
          cause : cause,
          response : error.name === 'AbortError' ? error.message : fetchErrorMessage
        });
      }

      if (!bookmarksorganizer.stopRequested && error.name === 'AbortError' && bookmark.attempts < bookmarksorganizer.MAX_ATTEMPTS) {
        await bookmarksorganizer.waitBeforeRetry();
        if (bookmarksorganizer.stopRequested) {
          return bookmark;
        }
        await bookmarksorganizer.checkHttpResponse(bookmark, 'GET');
      }
    }
    finally {
      const requestUrl = bookmarksorganizer.normalizeRequestUrl(bookmark.url);
      const activeRequests = bookmarksorganizer.activeDirectRequestUrls.get(requestUrl) || 0;
      if (activeRequests <= 1) {
        bookmarksorganizer.activeDirectRequestUrls.delete(requestUrl);
      }
      else {
        bookmarksorganizer.activeDirectRequestUrls.set(requestUrl, activeRequests - 1);
      }

      if (controller) {
        bookmarksorganizer.activeControllers.delete(controller);
      }
      if (directSlotAcquired) {
        bookmarksorganizer.releaseDirectRequestSlot();
      }
    }

    return bookmark;
  },

  /**
   * Normalizes request URLs so webRequest events can be matched to fetch failures.
   *
   * @param {string} url - request URL
   * @returns {string} normalized URL, or the original value if it is invalid
   */
  normalizeRequestUrl (url) {
    try {
      const normalizedUrl = new URL(url);
      normalizedUrl.hash = '';

      return normalizedUrl.href;
    }
    catch (error) {
      return url;
    }
  },

  /**
   * Captures the browser-provided network error code for active direct requests.
   *
   * @param {Object} details - webRequest error details
   * @returns {void}
   */
  onDirectRequestNetworkError (details) {
    const requestUrl = bookmarksorganizer.normalizeRequestUrl(details.url);

    if (bookmarksorganizer.activeDirectRequestUrls.has(requestUrl) && details.error) {
      bookmarksorganizer.directRequestNetworkErrors.set(requestUrl, details.error);
    }
  },

  /**
   * Detects Cloudflare markers in response metadata and challenge response bodies.
   *
   * @param {Response} response - the HTTP response
   * @returns {Promise<boolean>} - whether the response is a Cloudflare challenge
   */
  async isCloudflareChallengeResponse (response) {
    let metadata = response.url;
    response.headers.forEach((value, name) => {
      metadata += ` ${name} ${value}`;
    });
    if (CLOUDFLARE_CHALLENGE_MARKERS.test(metadata)) {
      return true;
    }

    if ([HTTP_FORBIDDEN_STATUS, HTTP_TOO_MANY_REQUESTS_STATUS, HTTP_SERVICE_UNAVAILABLE_STATUS].includes(response.status) && response.body) {
      const reader = response.clone().body.getReader();
      const decoder = new TextDecoder();
      let content = '';
      try {
        while (content.length < CHALLENGE_BODY_MAX_LENGTH) {
          // eslint-disable-next-line no-await-in-loop
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          content += decoder.decode(value, { stream : true });
          if (CLOUDFLARE_CHALLENGE_MARKERS.test(content)) {
            // eslint-disable-next-line no-await-in-loop
            await reader.cancel();

            return true;
          }
        }
      }
      finally {
        reader.releaseLock();
      }
    }

    return false;
  },

  /**
   * Normalizes saved Cloudflare hostnames from storage.
   *
   * @param {Array<string>} domains - hostnames stored in local storage
   * @returns {Array<string>} normalized hostnames
   */
  normalizeCloudflareDomains (domains) {
    if (!Array.isArray(domains)) {
      return [];
    }

    return Array.from(new Set(domains
      .filter((domain) => typeof domain === 'string')
      .map((domain) => domain.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''))
      .filter(Boolean)));
  },

  /**
   * Checks whether a URL belongs to a previously detected Cloudflare-protected host.
   *
   * @param {string} url - URL to check
   * @returns {boolean} whether its hostname is in the saved domain list
   */
  isCloudflareDomain (url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

      return Array.from(bookmarksorganizer.cloudflareDomains).some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    }
    catch (error) {
      return false;
    }
  },

  /**
   * Checks whether the host was marked direct-only after a FlareSolverr parse failure.
   *
   * @param {string} url - URL to check
   * @returns {boolean} whether its hostname is direct-only for this scan
   */
  isDirectOnlyDomain (url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

      return Array.from(bookmarksorganizer.directOnlyDomains).some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    }
    catch (error) {
      return false;
    }
  },

  /**
   * Saves a newly detected Cloudflare-protected host and serializes concurrent storage updates.
   *
   * @param {string} url - URL that returned a Cloudflare challenge
   * @returns {Promise<void>} resolves after the updated list has been persisted
   */
  addCloudflareDomain (url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
      if (!hostname || bookmarksorganizer.cloudflareDomains.has(hostname)) {
        return Promise.resolve();
      }

      bookmarksorganizer.cloudflareDomains.add(hostname);

      bookmarksorganizer.cloudflareDomainStorageQueue = bookmarksorganizer.cloudflareDomainStorageQueue
        // eslint-disable-next-line promise/prefer-await-to-callbacks
        .then(async () => {
          const { cloudflare } = await browser.storage.local.get({ cloudflare : [] });
          const domains = bookmarksorganizer.normalizeCloudflareDomains(cloudflare);
          if (!domains.includes(hostname)) {
            domains.push(hostname);
          }

          return browser.storage.local.set({ cloudflare : domains });
        })
        // eslint-disable-next-line promise/prefer-await-to-callbacks
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error('Unable to save Cloudflare domain list', error);
        });

      return bookmarksorganizer.cloudflareDomainStorageQueue;
    }
    catch (error) {
      // eslint-disable-next-line no-console
      console.error('Unable to detect Cloudflare domain from URL', error);

      return Promise.resolve();
    }
  },

  /**
   * Clears saved Cloudflare hosts and any loaded in-memory copy.
   *
   * @returns {Promise<void>} resolves after the list has been cleared
   */
  clearCloudflareDomains () {
    bookmarksorganizer.cloudflareDomains.clear();

    bookmarksorganizer.cloudflareDomainStorageQueue = bookmarksorganizer.cloudflareDomainStorageQueue
      // eslint-disable-next-line promise/prefer-await-to-callbacks
      .then(() => browser.storage.local.set({ cloudflare : [] }))
      // eslint-disable-next-line promise/prefer-await-to-callbacks
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Unable to clear Cloudflare domain list', error);
      });

    return bookmarksorganizer.cloudflareDomainStorageQueue;
  },

  /**
   * Evenly distributes saved Cloudflare-domain bookmarks among direct bookmarks.
   *
   * @param {Array<bookmarks.BookmarkTreeNode>} bookmarks - bookmarks to order
   * @returns {Array<bookmarks.BookmarkTreeNode>} reordered bookmarks
   */
  interleaveCloudflareBookmarks (bookmarks) {
    const urlIndexes = [];
    const cloudflareBookmarks = [];
    const directBookmarks = [];

    bookmarks.forEach((bookmark, index) => {
      if (bookmark.url) {
        urlIndexes.push(index);
        (bookmarksorganizer.isCloudflareDomain(bookmark.url) ? cloudflareBookmarks : directBookmarks).push(bookmark);
      }
    });

    if (cloudflareBookmarks.length === 0 || directBookmarks.length === 0) {
      return bookmarks;
    }

    const interleaved = new Array(urlIndexes.length);
    cloudflareBookmarks.forEach((bookmark, index) => {
      const position = Math.floor(((index + INTERLEAVE_POSITION_OFFSET) * urlIndexes.length) / cloudflareBookmarks.length);
      interleaved[position] = bookmark;
    });

    let directIndex = 0;
    for (let index = 0; index < interleaved.length; index++) {
      if (!interleaved[index]) {
        interleaved[index] = directBookmarks[directIndex++];
      }
    }

    const result = bookmarks.slice();
    urlIndexes.forEach((bookmarkIndex, index) => {
      result[bookmarkIndex] = interleaved[index];
    });

    return result;
  },

  /**
   * Waits before retrying, unless the user stops the check.
   *
   * @param {number|null} fixedDelay - optional fixed delay in milliseconds
   * @returns {Promise<void>} - resolves when the retry delay has elapsed or checking stops
   */
  async waitBeforeRetry (fixedDelay = null) {
    const delay = fixedDelay === null ? RETRY_DELAY_MIN_IN_MS + (Math.random() * (RETRY_DELAY_MAX_IN_MS - RETRY_DELAY_MIN_IN_MS)) : fixedDelay;
    await Promise.race([
      new Promise((resolve) => {
        setTimeout(resolve, delay);
      }),
      bookmarksorganizer.stopPromise
    ]);
  },

  /**
   * Enforces a hard timeout and stop cancellation around a request, including response body reads.
   *
   * @param {Function} requestFactory - creates the fetch promise and any required body parsing
   * @param {AbortController} controller - controller for the request
   * @param {number} timeout - timeout in milliseconds
   * @param {boolean} useAlarmWatchdog - whether to add an independent browser alarm watchdog
   * @param {Function|null} onTimeout - work to perform immediately when this request expires
   * @returns {Promise<*>} - request result
   */
  async withRequestTimeout (requestFactory, controller, timeout, useAlarmWatchdog = false, onTimeout = null) {
    let timeoutId = null;
    let alarmName = null;
    const abortError = new Error('Request aborted or timed out');
    abortError.name = 'AbortError';
    let cancelRequest = null;
    let rejectTimeout = null;
    let timeoutTriggered = false;
    const deadline = Date.now() + timeout;
    const timeoutPromise = new Promise((resolve, reject) => {
      rejectTimeout = reject;
    });
    const expireRequest = () => {
      if (timeoutTriggered) {
        return;
      }

      timeoutTriggered = true;
      rejectTimeout(abortError);
      if (onTimeout) {
        try {
          onTimeout();
        }
        catch (error) {
          // The timeout must still abort and reject the request if slot release fails.
        }
      }
      try {
        controller.abort(abortError);
      }
      catch (error) {
        // Rejecting the timeout race is sufficient to release the waiting task.
      }
    };
    const stopRequestPromise = new Promise((resolve, reject) => {
      cancelRequest = () => {
        controller.abort();
        reject(abortError);
      };
      bookmarksorganizer.activeRequestCancellations.add(cancelRequest);
    });

    timeoutId = setTimeout(expireRequest, timeout);
    if (useAlarmWatchdog && browser.alarms && browser.alarms.create) {
      alarmName = `${REQUEST_TIMEOUT_WATCHDOG_PREFIX}${Date.now()}-${++bookmarksorganizer.flareSolverrRequestSequence}`;
      bookmarksorganizer.flareSolverrTimeoutWatchdogs.set(alarmName, {
        deadline : deadline,
        expire : expireRequest
      });
    }

    try {
      if (alarmName) {
        try {
          await Promise.race([
            browser.storage.session.set({
              [alarmName] : {
                deadline : deadline,
                checkId : bookmarksorganizer.checkId
              }
            }),
            timeoutPromise,
            stopRequestPromise
          ]);
          await Promise.race([
            Promise.resolve(browser.alarms.create(alarmName, { when : deadline })),
            timeoutPromise,
            stopRequestPromise
          ]);
        }
        catch (error) {
          if (timeoutTriggered || bookmarksorganizer.stopRequested) {
            throw error;
          }
          // The local per-request timeout remains active if browser alarms are unavailable.
        }
      }

      // Arm the local timer and browser alarm before starting the network request.
      const requestPromise = Promise.resolve().then(requestFactory);

      return await Promise.race([
        requestPromise,
        timeoutPromise,
        stopRequestPromise
      ]);
    }
    finally {
      clearTimeout(timeoutId);
      bookmarksorganizer.activeRequestCancellations.delete(cancelRequest);
      if (alarmName) {
        bookmarksorganizer.flareSolverrTimeoutWatchdogs.delete(alarmName);
        try {
          Promise.resolve(browser.storage.session.remove(alarmName)).catch(() => false);
        }
        catch (error) {
          // The alarm is cleared below; stale session metadata is harmless.
        }
        try {
          Promise.resolve(browser.alarms.clear(alarmName)).catch(() => false);
        }
        catch (error) {
          // The request and its timeout have already completed; alarm cleanup is best effort.
        }
      }
    }
  },

  /**
   * Gets the deadline from current or legacy watchdog storage.
   *
   * @param {number|Object} watchdogRecord - stored watchdog record
   * @returns {?number} - the deadline, if present
   */
  getFlareSolverrWatchdogDeadline (watchdogRecord) {
    if (Number.isInteger(watchdogRecord)) {
      return watchdogRecord;
    }
    if (watchdogRecord && Number.isInteger(watchdogRecord.deadline)) {
      return watchdogRecord.deadline;
    }

    return null;
  },

  /**
   * Handles a FlareSolverr request deadline independently from the request promise.
   *
   * @param {alarms.Alarm} alarm - the fired browser alarm
   * @returns {Promise<void>} - resolves after handling the alarm
   */
  async handleFlareSolverrTimeoutAlarm (alarm) {
    const watchdog = bookmarksorganizer.flareSolverrTimeoutWatchdogs.get(alarm.name);
    if (!watchdog) {
      if (!alarm.name.startsWith(REQUEST_TIMEOUT_WATCHDOG_PREFIX) && !alarm.name.startsWith(LEGACY_FLARESOLVERR_WATCHDOG_PREFIX)) {
        return;
      }

      let storedWatchdog = null;
      try {
        const storedValues = await browser.storage.session.get(alarm.name);
        storedWatchdog = storedValues[alarm.name];
      }
      catch (error) {
        return;
      }

      const storedDeadline = bookmarksorganizer.getFlareSolverrWatchdogDeadline(storedWatchdog);
      if (!Number.isInteger(storedDeadline)) {
        return;
      }

      const remainingStoredTime = storedDeadline - Date.now();
      if (remainingStoredTime > 0) {
        try {
          await browser.alarms.create(alarm.name, { when : storedDeadline });
        }
        catch (error) {
          // A subsequent browser alarm or startup recovery will retry this deadline.
        }

        return;
      }

      try {
        await browser.storage.session.remove(alarm.name);
      }
      catch (error) {
        // The expired record is ignored after this alarm event.
      }
      const { [ACTIVE_CHECK_SESSION_KEY] : activeCheckId } = await browser.storage.session.get(ACTIVE_CHECK_SESSION_KEY);
      if (bookmarksorganizer.inProgress || !storedWatchdog || typeof storedWatchdog.checkId !== 'string' || activeCheckId !== storedWatchdog.checkId) {
        return;
      }

      try {
        await browser.storage.session.remove(ACTIVE_CHECK_SESSION_KEY);
      }
      catch (error) {
        // The UI still receives the timeout if the active-check marker cannot be cleared.
      }
      browser.runtime.sendMessage({ message : 'flare-scan-watchdog-timeout', checkId : storedWatchdog.checkId }).catch(() => null);

      return;
    }

    const remaining = watchdog.deadline - Date.now();
    if (remaining > 0) {
      try {
        await browser.alarms.create(alarm.name, { when : watchdog.deadline });
      }
      catch (error) {
        watchdog.expire();
      }

      return;
    }

    watchdog.expire();
  },

  /**
   * Re-arms persisted FlareSolverr watchdog alarms if the MV3 background context restarted.
   *
   * @returns {Promise<void>} - resolves after stored deadlines are restored
   */
  async recoverFlareSolverrTimeoutWatchdogs () {
    try {
      const storedValues = await browser.storage.session.get(null);
      for (const [alarmName, watchdogRecord] of Object.entries(storedValues)) {
        const deadline = bookmarksorganizer.getFlareSolverrWatchdogDeadline(watchdogRecord);
        if ((alarmName.startsWith(REQUEST_TIMEOUT_WATCHDOG_PREFIX) || alarmName.startsWith(LEGACY_FLARESOLVERR_WATCHDOG_PREFIX)) && Number.isInteger(deadline)) {
          const deadlineExpired = deadline <= Date.now();
          if (deadlineExpired) {
            // eslint-disable-next-line no-await-in-loop
            await bookmarksorganizer.handleFlareSolverrTimeoutAlarm({ name : alarmName });
          }

          // eslint-disable-next-line no-await-in-loop
          const alarm = deadlineExpired ? null : await browser.alarms.get(alarmName);
          if (!deadlineExpired && !alarm) {
            // eslint-disable-next-line no-await-in-loop
            await browser.alarms.create(alarmName, { when : deadline });
          }
        }
      }
    }
    catch (error) {
      // The active request still has its local deadline timer if alarm recovery fails.
    }
  },

  /**
   * Sends a FlareSolverr request using XMLHttpRequest's native network timeout.
   *
   * @param {string} url - URL to check
   * @param {number} timeout - request timeout in milliseconds
   * @param {AbortSignal} signal - signal used by the independent watchdog
   * @returns {Promise<Object>} - the FlareSolverr HTTP response and parsed JSON
   */
  requestFlareSolverr (url, timeout, signal) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      let settled = false;
      let abortRequest = null;
      const abortError = new Error('FlareSolverr request aborted or timed out');
      abortError.name = 'AbortError';

      const cleanup = () => {
        if (abortRequest) {
          signal.removeEventListener('abort', abortRequest);
        }
      };
      const rejectOnce = (error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      };
      abortRequest = () => {
        try {
          request.abort();
        }
        catch (error) {
          // The outer watchdog still settles the task if the browser rejects abort().
        }
        rejectOnce(abortError);
      };

      request.onload = () => {
        try {
          const result = JSON.parse(request.responseText);
          settled = true;
          cleanup();
          resolve({
            response : {
              ok : request.status >= HTTP_OK_STATUS && request.status < HTTP_MULTIPLE_CHOICES_STATUS,
              status : request.status
            },
            result : result
          });
        }
        catch (error) {
          if (error instanceof SyntaxError) {
            error.responseText = request.responseText;
          }

          rejectOnce(error);
        }
      };
      request.onerror = () => rejectOnce(new TypeError('FlareSolverr network request failed'));
      request.ontimeout = () => rejectOnce(abortError);
      request.onabort = () => rejectOnce(abortError);
      signal.addEventListener('abort', abortRequest, { once : true });

      try {
        request.open('POST', bookmarksorganizer.flareSolverrUrl, true);
        request.timeout = timeout;
        request.setRequestHeader('Content-Type', 'application/json');
        request.send(JSON.stringify({
          cmd : 'request.get',
          url : url,
          maxTimeout : timeout
          // waitInSeconds : 15
        }));

        if (signal.aborted) {
          abortRequest();
        }
      }
      catch (error) {
        rejectOnce(error);
      }
    });
  },

  /**
   * Checks a bookmark through the FlareSolverr request API.
   *
   * @param {bookmarks.BookmarkTreeNode} bookmark - a single bookmark
   *
   * @returns {bookmarks.BookmarkTreeNode} - the bookmark object
   */
  // eslint-disable-next-line complexity
  async checkFlareSolverrResponse (bookmark) {
    let controller = null;
    let slotAcquired = false;
    let slotReleased = false;
    let retryDirectly = false;
    const releaseSlot = () => {
      if (slotAcquired && !slotReleased) {
        slotReleased = true;
        slotAcquired = false;
        bookmarksorganizer.releaseFlareSolverrSlot();
      }
    };

    try {
      await bookmarksorganizer.waitForRequestDelay('flareSolverr');

      if (bookmarksorganizer.stopRequested) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;

        return bookmark;
      }

      slotAcquired = await bookmarksorganizer.acquireFlareSolverrSlot();
      if (!slotAcquired) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;

        return bookmark;
      }

      controller = new AbortController();
      bookmarksorganizer.activeControllers.add(controller);
      const flareSolverrTimeout = bookmarksorganizer.FLARESOLVERR_REQUEST_TIMEOUT_IN_MS;
      const { result } = await bookmarksorganizer.withRequestTimeout(() => bookmarksorganizer.requestFlareSolverr(bookmark.url, flareSolverrTimeout, controller.signal), controller, flareSolverrTimeout, true, releaseSlot);
      if (result.status === 'ok' && result.solution) {
        // continue with the successful solution below
      }
      else {
        const detail = result.message || 'FlareSolverr returned an error';
        throw new Error(detail);
      }

      const { solution } = result;
      if (bookmarksorganizer.showRequestResults) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.flareSolverrResult = solution.status !== STATUS.NOT_FOUND && solution.status < HTTP_ERROR_STATUS && solution.url && solution.url !== bookmark.url ? browser.i18n.getMessage('redirect_result') : `HTTP ${solution.status}`;
      }

      // eslint-disable-next-line require-atomic-updates
      if (!Number.isInteger(solution.status)) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;
      }
      else if (solution.status === STATUS.NOT_FOUND) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.NOT_FOUND;
      }
      else if (solution.status >= HTTP_ERROR_STATUS) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;
      }
      else {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = solution.status;
      }
      if (solution.status !== STATUS.NOT_FOUND && solution.status < HTTP_ERROR_STATUS && solution.url && solution.url !== bookmark.url) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.REDIRECT;
        bookmark.newUrl = solution.url;

        if (bookmark.url.indexOf('#') !== -1) {
          bookmark.newUrl += bookmark.url.substring(bookmark.url.indexOf('#'));
        }
      }

      if (bookmarksorganizer.debugEnabled) {
        bookmarksorganizer.debug.push({
          bookmark : {
            id : bookmark.id,
            parentId : bookmark.parentId,
            title : bookmark.title,
            url : bookmark.url,
            status : bookmark.status
          },
          method : 'GET (FlareSolverr)',
          cause : 'server-response',
          response : {
            url : solution.url,
            status : solution.status,
            message : result.message
          }
        });
      }
    }
    catch (error) {
      if (bookmarksorganizer.stopRequested && error.name === 'AbortError') {
        // eslint-disable-next-line require-atomic-updates
        bookmark.status = STATUS.UNKNOWN;

        return bookmark;
      }
      if (error instanceof SyntaxError && bookmarksorganizer.directFallbackFlareSolverrJsonError) {
        try {
          const hostname = new URL(bookmark.url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
          bookmarksorganizer.directOnlyDomains.add(hostname);
          retryDirectly = true;
        }
        catch (urlError) {
          // A malformed bookmark URL cannot be added to the direct-only list.
        }
      }
      if (error instanceof SyntaxError && bookmarksorganizer.debugEnabled) {
        bookmarksorganizer.flareSolverrJsonErrors.push({
          url : bookmark.url,
          responseText : error.responseText || ''
        });
      }
      if (bookmarksorganizer.showRequestResults) {
        let flareSolverrResult = error.message;
        if (error instanceof SyntaxError) {
          flareSolverrResult = browser.i18n.getMessage('flaresolverr_returned_error');
        }
        else if (error.name === 'AbortError') {
          flareSolverrResult = browser.i18n.getMessage('flaresolverr_timeout');
        }

        // eslint-disable-next-line require-atomic-updates
        bookmark.flareSolverrResult = flareSolverrResult;
      }

      // eslint-disable-next-line require-atomic-updates
      bookmark.status = STATUS.UNKNOWN;

      if (bookmarksorganizer.debugEnabled) {
        bookmarksorganizer.debug.push({
          bookmark : {
            id : bookmark.id,
            parentId : bookmark.parentId,
            title : bookmark.title,
            url : bookmark.url,
            status : bookmark.status
          },
          method : 'GET (FlareSolverr)',
          cause : error.name === 'AbortError' ? 'timeout' : 'fetch-error',
          response : error instanceof SyntaxError ? browser.i18n.getMessage('flaresolverr_returned_error') : error.message
        });
      }
    }
    finally {
      if (controller) {
        bookmarksorganizer.activeControllers.delete(controller);
      }
      releaseSlot();
    }

    if (retryDirectly && !bookmarksorganizer.stopRequested) {
      await Promise.race([
        new Promise((resolve) => {
          setTimeout(resolve, FLARESOLVERR_JSON_PARSE_RETRY_DELAY_IN_MS);
        }),
        bookmarksorganizer.stopPromise
      ]);
      if (!bookmarksorganizer.stopRequested) {
        // eslint-disable-next-line require-atomic-updates
        bookmark.attempts = 0;

        return bookmarksorganizer.checkHttpResponse(bookmark, 'HEAD');
      }
    }

    return bookmark;
  },

  /**
   * Acquires one of the two concurrent FlareSolverr request slots.
   *
   * @returns {Promise<boolean>} - whether a slot was acquired
   */
  acquireFlareSolverrSlot () {
    if (bookmarksorganizer.stopRequested) {
      return Promise.resolve(false);
    }
    if (bookmarksorganizer.activeFlareSolverrRequests < FLARESOLVERR_MAX_CONCURRENT_REQUESTS) {
      bookmarksorganizer.activeFlareSolverrRequests++;

      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      bookmarksorganizer.flareSolverrWaiters.push({ resolve : resolve, cancelled : false });
    });
  },

  /**
   * Acquires a direct HTTP slot using the configured maximum, independently of FlareSolverr.
   *
   * @returns {Promise<boolean>} - whether a slot was acquired
   */
  acquireDirectRequestSlot () {
    if (bookmarksorganizer.stopRequested) {
      return Promise.resolve(false);
    }
    if (bookmarksorganizer.activeDirectRequests < bookmarksorganizer.maxConcurrentRequests) {
      bookmarksorganizer.activeDirectRequests++;

      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      bookmarksorganizer.directRequestWaiters.push({ resolve : resolve, cancelled : false });
    });
  },

  /**
   * Releases a direct HTTP slot and grants it to the next queued request.
   *
   * @returns {void}
   */
  releaseDirectRequestSlot () {
    let waiter = bookmarksorganizer.directRequestWaiters.shift();
    while (waiter && waiter.cancelled) {
      waiter = bookmarksorganizer.directRequestWaiters.shift();
    }
    if (waiter) {
      waiter.resolve(true);

      return;
    }

    bookmarksorganizer.activeDirectRequests = Math.max(0, bookmarksorganizer.activeDirectRequests - 1);
  },

  /**
   * Releases a FlareSolverr slot and grants it to the next queued bookmark.
   *
   * @returns {void}
   */
  releaseFlareSolverrSlot () {
    let waiter = bookmarksorganizer.flareSolverrWaiters.shift();
    while (waiter && waiter.cancelled) {
      waiter = bookmarksorganizer.flareSolverrWaiters.shift();
    }
    if (waiter) {
      waiter.resolve(true);

      return;
    }

    bookmarksorganizer.activeFlareSolverrRequests = Math.max(0, bookmarksorganizer.activeFlareSolverrRequests - 1);
  },

  /**
   * Waits until the configured delay has elapsed since the previous request of this type started.
   *
   * @param {'direct'|'flareSolverr'} requestType - the independent request lane
   * @returns {Promise<void>} A promise that resolves when the next request may start.
   */
  async waitForRequestDelay (requestType) {
    const previousRequest = bookmarksorganizer.requestStartQueues[requestType];
    let releaseRequest = null;

    bookmarksorganizer.requestStartQueues[requestType] = new Promise((resolve) => {
      releaseRequest = resolve;
    });

    await Promise.race([previousRequest, bookmarksorganizer.stopPromise]);

    if (bookmarksorganizer.stopRequested) {
      releaseRequest();

      return;
    }

    const waitTime = bookmarksorganizer.lastRequestStartedAt[requestType] + bookmarksorganizer.REQUEST_DELAY_IN_MS - Date.now();
    if (waitTime > 0) {
      await Promise.race([
        new Promise((resolve) => {
          setTimeout(resolve, waitTime);
        }),
        bookmarksorganizer.stopPromise
      ]);
    }

    if (bookmarksorganizer.stopRequested) {
      releaseRequest();

      return;
    }

    // eslint-disable-next-line require-atomic-updates
    bookmarksorganizer.lastRequestStartedAt[requestType] = Date.now();
    releaseRequest();
  },

  /**
   * This method iterates over the full bookmark tree and pushes all bookmarks (except separators) to a global
   * array of bookmarks.
   *
   * @param {bookmarks.BookmarkTreeNode} bookmark - a single bookmark
   * @param {boolean} updateCounter - whether the number of total bookmarks should be updated or not
   *
   * @returns {Promise<void>} - resolves after the bookmark tree has been collected
   */
  async collectAllBookmarks (bookmark, updateCounter) {
    if (bookmarksorganizer.LIMIT > 0 && bookmarksorganizer.totalBookmarks === bookmarksorganizer.LIMIT) {
      return;
    }

    if (bookmark.type === 'separator') {
      return;
    }

    bookmarksorganizer.collectedBookmarks.push(bookmark);

    if (bookmark.url) {
      bookmarksorganizer.totalBookmarks++;
    }

    if (bookmark.children) {
      for (const child of bookmark.children) {
        // eslint-disable-next-line no-await-in-loop
        await bookmarksorganizer.collectAllBookmarks(child, false);
      }
    }

    if (updateCounter) {
      await browser.storage.session.set({ totalBookmarks : bookmarksorganizer.totalBookmarks });

      browser.runtime.sendMessage({
        message : 'total-bookmarks-changed',
        total_bookmarks : bookmarksorganizer.totalBookmarks
      });
    }
  },

  /**
   * This method iterates over the full bookmark tree and pushes all bookmarks (except separators) to a global
   * array of bookmarks.
   *
   * @param {string} mode - The checking mode<br /><br />
   *                 <strong>Supported values:</strong> broken-bookmarks, duplicates, empty-names
   * @param {string} type - The requested type of results<br /><br />
   *                 <strong>Supported values:</strong> errors, warnings, all
   *
   * @returns {Promise.<Array.<*>>} - Promise
   */
  async processBookmarks (mode, type) {
    let bookmarksToProcess = bookmarksorganizer.collectedBookmarks;

    if (bookmarksorganizer.shuffleUrls) {
      bookmarksToProcess = bookmarksorganizer.shuffleBookmarksByDomain(bookmarksToProcess);
    }
    if (bookmarksorganizer.useFlareSolverr && bookmarksorganizer.useCloudflareDomainRouting) {
      bookmarksToProcess = bookmarksorganizer.interleaveCloudflareBookmarks(bookmarksToProcess);
    }

    const tasks = bookmarksToProcess.map(async (aBookmark) => {
      try {
        if (!bookmarksorganizer.stopRequested && !bookmarksorganizer.checkFinalized) {
          if (aBookmark.url) {
            bookmarksorganizer.activeBookmarkChecks.set(aBookmark.id, aBookmark);
          }

          await bookmarksorganizer.checkForBrokenBookmark(aBookmark, mode, type);
        }
      }
      catch (error) {
        if (aBookmark.url && !bookmarksorganizer.checkFinalized) {
          // A cancelled in-flight task still belongs in the partial results. Treat
          // it as unknown, since stopping the scan does not prove the link is dead.
          // eslint-disable-next-line require-atomic-updates
          aBookmark.status = bookmarksorganizer.stopRequested ? STATUS.UNKNOWN : STATUS.FETCH_ERROR;

          if ((type === 'all' || type === 'errors') && !bookmarksorganizer.bookmarksResult.some(({ id }) => id === aBookmark.id)) {
            if (!bookmarksorganizer.stopRequested) {
              bookmarksorganizer.bookmarkErrors++;
            }
            bookmarksorganizer.bookmarksResult.push(aBookmark);
          }

          bookmarksorganizer.markBookmarkChecked(aBookmark);
          bookmarksorganizer.updateProgressUi();
        }
      }
      finally {
        bookmarksorganizer.activeBookmarkChecks.delete(aBookmark.id);
      }
    });

    const allTasksSettled = Promise.allSettled(tasks);
    await Promise.race([allTasksSettled, bookmarksorganizer.stopPromise]);

    if (bookmarksorganizer.stopRequested) {
      await Promise.race([
        allTasksSettled,
        new Promise((resolve) => {
          setTimeout(resolve, STOP_TASK_DRAIN_TIMEOUT_IN_MS);
        })
      ]);
    }
  },

  /**
   * Shuffles URL bookmarks while spacing out entries from the same hostname when possible.
   *
   * @param {Array.<bookmarks.BookmarkTreeNode>} bookmarks - the bookmark entries to shuffle
   *
   * @returns {Array.<bookmarks.BookmarkTreeNode>} - bookmark entries with URLs in a balanced order
   */
  shuffleBookmarksByDomain (bookmarks) {
    const groupsByDomain = new Map();

    for (const bookmark of bookmarks) {
      if (bookmark.url) {
        let domain = `unknown-${bookmark.id}`;
        try {
          domain = new URL(bookmark.url).hostname.toLowerCase().replace(/^www\./, '') || domain;
        }
        catch (error) {
          // Keep malformed and non-network URLs in their own groups.
        }

        if (!groupsByDomain.has(domain)) {
          groupsByDomain.set(domain, []);
        }

        groupsByDomain.get(domain).push(bookmark);
      }
    }

    for (const group of groupsByDomain.values()) {
      for (let i = group.length - 1; i > 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        [group[i], group[randomIndex]] = [group[randomIndex], group[i]];
      }
    }

    const groups = Array.from(groupsByDomain, ([domain, items]) => ({ domain : domain, items : items }));
    for (let i = groups.length - 1; i > 0; i--) {
      const randomIndex = Math.floor(Math.random() * (i + 1));
      [groups[i], groups[randomIndex]] = [groups[randomIndex], groups[i]];
    }
    groups.sort((firstGroup, secondGroup) => secondGroup.items.length - firstGroup.items.length);

    const shuffledUrls = [];
    let previousDomain = null;
    while (groups.length > 0) {
      let groupIndex = 0;
      while (groupIndex < groups.length && groups[groupIndex].domain === previousDomain) {
        groupIndex++;
      }

      if (groupIndex === groups.length) {
        groupIndex = 0;
      }

      const [group] = groups.splice(groupIndex, 1);
      shuffledUrls.push(group.items.pop());
      previousDomain = group.domain;

      if (group.items.length > 0) {
        groups.push(group);
        groups.sort((firstGroup, secondGroup) => secondGroup.items.length - firstGroup.items.length);
      }
    }

    let urlIndex = 0;

    return bookmarks.map((bookmark) => {
      if (!bookmark.url) {
        return bookmark;
      }

      return shuffledUrls[urlIndex++];
    });
  },

  /**
   * This method provides the mechanics to throttle the requests. We do not want to execute more than queue_size
   * requests at the same time to improve the reliability of the bookmarks check.
   *
   * @param {int} queue_size - do not process more than queue_size bookmarks at the same time
   *
   * @returns {Object} - Object
   */
  throttle (queue_size) {
    const queue = {
      available : queue_size,
      maximum : queue_size
    };

    const futures = [];

    queue.take = function () {
      if (queue.available > 0) {
        queue.available -= 1;

        return Promise.resolve();
      }

      return new Promise((resolve) => {
        futures.push(resolve);
      });
    };

    let emptyPromiseResolver = null;
    const emptyPromise = new Promise((resolve) => {
      emptyPromiseResolver = resolve;
    });

    queue.give = function () {
      if (futures.length) {
        const future = futures.shift();

        future();
      }
      else {
        queue.available += 1;

        if (queue.available === queue.maximum) {
          emptyPromiseResolver('empty queue');
        }
      }
    };

    queue.emptyPromise = function () {
      return emptyPromise;
    };

    return queue;
  },

  /**
   * This method assigns the full bookmark path to a bookmark object. It's only used for the duplicates mode.
   *
   * @param {bookmarks.BookmarkTreeNode} bookmark - a single bookmark
   * @returns {void}
   */
  checkBookmarkAndAssignPath (bookmark) {
    if (bookmark.url) {
      if (bookmarksorganizer.LIMIT > 0 && bookmarksorganizer.internalCounter === bookmarksorganizer.LIMIT) {
        return;
      }

      bookmark.path = bookmarksorganizer.additionalData[bookmark.id].path;

      bookmarksorganizer.internalCounter++;
      bookmarksorganizer.checkedBookmarks++;
      bookmarksorganizer.updateProgressUi();
    }

    bookmarksorganizer.bookmarksResult.push(bookmark);
  },

  /**
   * This method is used to check for bookmarks with empty name.
   *
   * @param {bookmarks.BookmarkTreeNode} bookmark - a single bookmark
   * @returns {void}
   */
  checkForEmptyName (bookmark) {
    if (bookmark.url) {
      if (bookmarksorganizer.LIMIT > 0 && bookmarksorganizer.internalCounter === bookmarksorganizer.LIMIT) {
        return;
      }

      bookmarksorganizer.internalCounter++;

      // skip place:-URIs (issue #3)
      if (!bookmark.url.startsWith('place:')) {
        if (!bookmark.title) {
          bookmarksorganizer.bookmarkErrors++;
          bookmarksorganizer.bookmarksResult.push(bookmark);
        }
      }

      bookmarksorganizer.checkedBookmarks++;
      bookmarksorganizer.updateProgressUi();
    }
    else {
      bookmarksorganizer.bookmarksResult.push(bookmark);
    }
  },

  /**
   * This method is used to check for duplicates.
   *
   * @returns {void}
   */
  checkForDuplicates () {
    const duplicates = { };

    bookmarksorganizer.bookmarksResult.forEach((bookmark) => {
      if (bookmark.url) {
        if (duplicates[bookmark.url]) {
          duplicates[bookmark.url].push(bookmark);
        }
        else {
          duplicates[bookmark.url] = [bookmark];
        }
      }
    });

    Object.keys(duplicates).forEach((key) => {
      if (duplicates[key].length < 2) {
        delete duplicates[key];
      }
      else {
        bookmarksorganizer.bookmarkErrors++;
      }
    });

    browser.runtime.sendMessage({
      message : 'show-duplicates-ui',
      bookmarks : duplicates,
      errors : bookmarksorganizer.bookmarkErrors,
      disableConfirmations : bookmarksorganizer.disableConfirmations,
      stopped : bookmarksorganizer.stopRequested
    });

    bookmarksorganizer.inProgress = false;
  },

  /**
   * This method is used to send the progress to the UI script.
   *
   * @returns {void}
   */
  updateProgressUi () {
    let progress = bookmarksorganizer.checkedBookmarks / bookmarksorganizer.totalBookmarks;
    if (progress < MIN_PROGRESS) {
      progress = MIN_PROGRESS;
    }

    const progressMessage = {
      message : 'update-counters',
      total_bookmarks : bookmarksorganizer.totalBookmarks,
      checked_bookmarks : bookmarksorganizer.checkedBookmarks,
      bookmarks_errors : bookmarksorganizer.bookmarkErrors,
      bookmarks_warnings : bookmarksorganizer.bookmarkWarnings,
      progress : progress
    };

    if (bookmarksorganizer.lastPartialResultsCount !== bookmarksorganizer.bookmarksResult.length) {
      const resultsById = new Map(bookmarksorganizer.bookmarksResult.map((bookmark) => [bookmark.id, { ...bookmark }]));
      const collectedById = new Map(bookmarksorganizer.collectedBookmarks.map((bookmark) => [bookmark.id, bookmark]));
      for (const bookmark of Array.from(resultsById.values())) {
        let { parentId } = bookmark;
        while (parentId && !resultsById.has(parentId)) {
          const parent = collectedById.get(parentId);
          if (!parent) {
            break;
          }

          resultsById.set(parentId, { ...parent });
          const { parentId : nextParentId } = parent;
          parentId = nextParentId;
        }
      }

      const resultTree = bookmarksorganizer.buildResultArray(Array.from(resultsById.values()));
      const { children = [] } = resultTree[0] || {};
      progressMessage.partial_bookmarks = children;
      bookmarksorganizer.lastPartialResultsCount = bookmarksorganizer.bookmarksResult.length;
    }

    browser.runtime.sendMessage(progressMessage);
  },

  /**
   * Sends the accumulated results and releases the active check.
   *
   * @param {string} mode - the check mode
   *
   * @returns {Promise<void>} - resolves after the check results have been sent
   */
  async finishCheck (mode) {
    if (!bookmarksorganizer.inProgress || bookmarksorganizer.checkFinalized) {
      return;
    }

    if (bookmarksorganizer.stopRequested) {
      for (const bookmark of bookmarksorganizer.activeBookmarkChecks.values()) {
        bookmark.status = STATUS.UNKNOWN;
        if ((bookmarksorganizer.type === 'all' || bookmarksorganizer.type === 'errors') && !bookmarksorganizer.bookmarksResult.some(({ id }) => id === bookmark.id)) {
          bookmarksorganizer.bookmarksResult.push(bookmark);
        }

        bookmarksorganizer.markBookmarkChecked(bookmark);
      }
    }

    bookmarksorganizer.checkFinalized = true;
    const { checkId } = bookmarksorganizer;
    try {
      await browser.storage.session.remove(ACTIVE_CHECK_SESSION_KEY);
    }
    catch (error) {
      // Normal completion still proceeds if the session marker cannot be cleared.
    }

    const resultsById = new Set(bookmarksorganizer.bookmarksResult.map(({ id }) => id));
    const collectedById = new Map(bookmarksorganizer.collectedBookmarks.map((bookmark) => [bookmark.id, bookmark]));
    const currentResults = bookmarksorganizer.bookmarksResult.slice();

    for (const bookmark of currentResults) {
      let { parentId } = bookmark;

      while (parentId && !resultsById.has(parentId)) {
        const parent = collectedById.get(parentId);
        if (!parent) {
          break;
        }

        bookmarksorganizer.bookmarksResult.push(parent);
        resultsById.add(parent.id);
        const { parentId : grandparentId } = parent;
        parentId = grandparentId;
      }
    }

    const resultTree = bookmarksorganizer.buildResultArray(bookmarksorganizer.bookmarksResult);
    bookmarksorganizer.updateProgressUi();
    let hasFlareSolverrJsonErrors = false;

    if (bookmarksorganizer.debugEnabled && bookmarksorganizer.flareSolverrJsonErrors.length > 0) {
      try {
        await browser.storage.session.set({
          [FLARESOLVERR_JSON_ERRORS_SESSION_KEY] : bookmarksorganizer.flareSolverrJsonErrors
        });
        hasFlareSolverrJsonErrors = true;
      }
      catch (error) {
        // eslint-disable-next-line no-console
        console.error('Unable to save FlareSolverr JSON error details', error);
      }
    }

    browser.runtime.sendMessage({
      message : 'finished',
      mode : mode,
      bookmarks : resultTree.length ? resultTree[0].children : [],
      totalBookmarks : bookmarksorganizer.totalBookmarks,
      checkedBookmarks : bookmarksorganizer.checkedBookmarks,
      bookmarksErrors : bookmarksorganizer.bookmarkErrors,
      bookmarksWarnings : bookmarksorganizer.bookmarkWarnings,
      disableConfirmations : bookmarksorganizer.disableConfirmations,
      debug : bookmarksorganizer.debug,
      hasFlareSolverrJsonErrors : hasFlareSolverrJsonErrors,
      stopped : bookmarksorganizer.stopRequested,
      checkId : checkId
    });

    bookmarksorganizer.inProgress = false;
    bookmarksorganizer.checkId = null;
  },

  /**
   * Builds a sorted array (by path) with the results (bookmarks with errors and warnings). Only used for broken
   * bookmarks and bookmarks with empty names, not for duplicates.
   *
   * @param {Array.<bookmarks.BookmarkTreeNode>} bookmarks - a tree of bookmarks
   *
   * @returns {Array.<bookmarks.BookmarkTreeNode>} - an array with the result of bookmarks with errors and warnings
   */
  buildResultArray (bookmarks) {
    const result = [];
    const mappedArray = {};
    let mappedElement = null;

    for (const bookmark of bookmarks) {
      mappedArray[bookmark.id] = bookmark;
      mappedArray[bookmark.id].children = [];
    }

    for (const id in mappedArray) {
      if (Object.hasOwn(mappedArray, id)) {
        mappedElement = mappedArray[id];
        if (mappedElement.parentId && mappedArray[mappedElement.parentId]) {
          mappedArray[mappedElement.parentId].children.push(mappedElement);
        }
        else {
          result.push(mappedElement);
        }
      }
    }

    return result;
  },

  /**
   * Adds a bookmark to the whitelist.
   *
   * @param {int} bookmarkId - the id of the bookmark
   *
   * @returns {void}
   */
  async addToWhitelist (bookmarkId) {
    const { whitelist } = await browser.storage.local.get({ whitelist : [] });

    if (!whitelist.includes(bookmarkId)) {
      whitelist.push(bookmarkId);
      browser.storage.local.set({ whitelist : whitelist });
    }
  }
};

browser.permissions.onAdded.addListener(bookmarksorganizer.onPermissionGranted);
browser.permissions.onRemoved.addListener(bookmarksorganizer.onPermissionRevoked);
browser.bookmarks.onCreated.addListener(bookmarksorganizer.onBookmarkCreated);
browser.bookmarks.onChanged.addListener(bookmarksorganizer.onBookmarkChanged);
browser.bookmarks.onRemoved.addListener(bookmarksorganizer.onBookmarkRemoved);
browser.action.onClicked.addListener(bookmarksorganizer.openUserInterface);
browser.omnibox.onInputChanged.addListener(bookmarksorganizer.showOmniboxSuggestions);
browser.omnibox.onInputEntered.addListener(bookmarksorganizer.callOmniboxAction);
browser.omnibox.setDefaultSuggestion({ description : browser.i18n.getMessage('omnibox_default_description') });
browser.alarms.onAlarm.addListener((alarm) => bookmarksorganizer.handleFlareSolverrTimeoutAlarm(alarm));
browser.runtime.onMessage.addListener(bookmarksorganizer.handleResponse);
browser.webRequest.onErrorOccurred.addListener(bookmarksorganizer.onDirectRequestNetworkError, {
  urls : ['<all_urls>']
});

bookmarksorganizer.recoverFlareSolverrTimeoutWatchdogs().catch(() => false);

(async () => {
  const { contextMenuInitialized } = await browser.storage.session.get('isContextMenuInitialized');
  if (!contextMenuInitialized) {
    browser.menus.create({
      id : 'bmo-tools-menu-entry',
      title : browser.i18n.getMessage('omnibox_command_check_organizer'),
      contexts : ['tools_menu'],
      command : '_execute_action'
    });
  }
})();
