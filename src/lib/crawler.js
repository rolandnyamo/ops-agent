/**
 * Puppeteer-based Crawler
 * 
 * This module contains the logic for crawling web pages using Puppeteer,
 * which is necessary for sites that heavily rely on JavaScript to render content.
 */

const puppeteerCore = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const path = require('path');
const os = require('os');

const browserViewport = {
  mobile: { width: 375, height: 667 }, // iPhone 6/7/8
  desktop: { width: 1280, height: 800 }, // Standard desktop viewport
  desktop_long: { width: 1280, height: 1980 }, // Long desktop viewport
}

const adminDefinedSelectors = [
  '[data-testid="scroll-container"]',
  '[class*="scrollable"]',
  '.scroll-list',
  '.infinite-scroll'
];

// Recommended Puppeteer launch arguments for stability, especially in containerized environments
const puppeteerLaunchArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=VizDisplayCompositor',
  '--disable-features=TranslateUI',
  // '--disable-dev-shm-usage',
  // '--disable-accelerated-2d-canvas',
  // '--no-first-run',
  // '--no-zygote',
  // '--disable-gpu'
];

/**
 * Captures the fully rendered HTML of a page using Puppeteer.
 * @param {string} url - The URL to crawl.
 * @param {string|null} screenshotPath - Optional path to save screenshot.
 * @param {string} viewport - Viewport size ('mobile' or 'desktop').
 * @param {number} timeout - Page load timeout in milliseconds.
 * @param {boolean} saveResult - Whether to save the HTML result to S3 (defaults to false).
 * @param {string} env - Environment for S3 bucket selection (defaults to 'staging').
 * @returns {Promise<Object|null>} A promise that resolves to the crawl result object, or null on failure.
 */
async function crawlWithPuppeteer({ 
  url, 
  screenshotPath = null, 
  viewport = 'desktop_long', 
  timeout = 45000, 
  saveResult = false, 
  env = 'staging' 
}) {
  // Generate unique crawl ID for debugging
  const crawlId = Math.random().toString(36).substring(2, 8);
  console.log(`🚀 [${crawlId}] Starting Puppeteer crawl for: ${url}`);
  
  const { browser, profileDir } = await getBrowser(env);

  try {
    const page = await browser.newPage();
    
    
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    await page.setViewport(browserViewport[viewport]);

    console.log('🌐 Waiting for page to load...');
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout });
    } catch (error) {
      console.error(`❌ Error navigating to ${url}:`, error.message);
      console.error(error);
      // For certain critical errors, return null instead of continuing
      if (error.message.includes('ERR_NAME_NOT_RESOLVED') || 
          error.message.includes('ERR_INTERNET_DISCONNECTED') ||
          error.message.includes('ERR_CONNECTION_REFUSED')) {
        console.error(`💥 Critical navigation error, aborting crawl`);
        return null;
      }
      // For other errors (like timeouts), continue and try to get whatever content is available
    }
    console.log('✅ Loaded page url', page.url());

    let fullScreenshotPath = null;

    // Take screenshot only if screenshotPath is provided
    if (screenshotPath) {

      // Scroll to load all content (for infinite scroll or lazy loading)
      console.log('📜 Scrolling to load all content...');
      await autoScroll(page);
      // Determine screenshot path based on environment
      const isLambda = Boolean(process.env.LAMBDA_TASK_ROOT);
      const baseLambdaPath = '/tmp/screenshots';
      fullScreenshotPath = isLambda 
        ? `${baseLambdaPath}${screenshotPath}`
        : screenshotPath;

      // Create screenshots directory if in Lambda
      if (isLambda) {
        const fs = require('fs');
        const path = require('path');

        if (!fs.existsSync(baseLambdaPath)) {
          fs.mkdirSync(baseLambdaPath, { recursive: true });
        }
      }

      // Take full page screenshot
      await page.screenshot({ 
        path: fullScreenshotPath,
        fullPage: true 
      });
      console.log(`📸 Screenshot saved: ${fullScreenshotPath}`);
    }

    // Wait for a reasonable time or a specific element to ensure JS has rendered
    // await page.waitForTimeout(5000); // Wait 5 seconds for dynamic content

    const html = await page.content();
    console.log(`📄 Puppeteer crawl successful. HTML size: ${html.length}`);
    
    const result = { html, finalUrl: page.url() };
    if (fullScreenshotPath) {
      result.screenshotPath = fullScreenshotPath;
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Puppeteer crawl failed for ${url}:`, error.message);
    return null;
  } finally {
    if (browser) {
      await browser.close();
      console.log('▶️ Browser closed.');
    }
  }
}

async function getBrowser(env) {
  try {
    const isLambda = Boolean(process.env.LAMBDA_TASK_ROOT);
    console.log(`🌍 Running in ${isLambda ? 'AWS Lambda' : 'local development'} environment`);

    // Determine where to store the profile locally
    const profileDir = isLambda ? '/tmp/profile' : path.join(os.homedir(), '.crawl_profile');
    
    if (isLambda) {
      const executablePath = await chromium.executablePath();
      const args = chromium.args.concat(puppeteerLaunchArgs);
  
      console.log('Executable path:', executablePath);
      const browser = await puppeteerCore.launch({
        executablePath,
        args,
        headless: chromium.headless,
        defaultViewport: chromium.defaultViewport,
        ignoreHTTPSErrors: true,
        userDataDir: profileDir
      });

      return { browser, profileDir };
    } else {
      // Local development - try to find Chrome/Chromium executable
      console.log('🖥️  Launching local Puppeteer browser...');
      
      // Common Chrome/Chromium executable paths
      const possiblePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS Chrome
        '/Applications/Chromium.app/Contents/MacOS/Chromium', // macOS Chromium
        '/usr/bin/google-chrome', // Linux Chrome
        '/usr/bin/chromium-browser', // Linux Chromium
        '/usr/bin/chromium', // Linux Chromium alt
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Windows Chrome
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' // Windows Chrome (x86)
      ];
      
      const fs = require('fs');
      let executablePath = null;
      
      // Find first available executable
      for (const path of possiblePaths) {
        if (fs.existsSync(path)) {
          executablePath = path;
          console.log(`📍 Found Chrome at: ${executablePath}`);
          break;
        }
      }
      
      if (!executablePath) {
        // Fallback to chromium from @sparticuz/chromium even in local development
        console.log('🔄 No local Chrome found, using bundled Chromium...');
        executablePath = await chromium.executablePath();
      }
      
      const browser = await puppeteerCore.launch({
        executablePath,
        args: puppeteerLaunchArgs,
        headless: true, // Set to false for debugging
        defaultViewport: null,
        ignoreHTTPSErrors: true,
        userDataDir: profileDir
      });

      return { browser, profileDir };
    }
  } catch (error) {
    console.log('getBrowser error:', error);
    throw new Error('Browser launch failed');
  }
}

/**
 * Auto-scroll function to trigger loading of lazy/infinite scroll content
 */
async function autoScroll(page) {
  console.log('📜 Starting auto-scroll...');
  
  const result = await page.evaluate(async () => {
    // Define selectors inside the browser context
    const adminDefinedSelectors = [
      '[data-testid="scroll-container"]',
      '[class*="scrollable"]',
      '.scroll-list',
      '.infinite-scroll'
    ];

    function getAdminDefinedScrollables() {
      return adminDefinedSelectors
        .map(sel => document.querySelector(sel))
        .filter(el => el && el.scrollHeight > el.clientHeight);
    }

    function findFallbackScrollables() {
      const elements = document.querySelectorAll('*');
      const scrollables = [];
      elements.forEach(el => {
        const style = window.getComputedStyle(el);
        const hasScroll = el.scrollHeight > el.clientHeight;
        const isScrollable =
          style.overflowY === 'scroll' ||
          style.overflowY === 'auto' ||
          style.overflow === 'scroll' ||
          style.overflow === 'auto';
        if (hasScroll && isScrollable) {
          scrollables.push(el);
        }
      });
      return scrollables;
    }

    let scrollableElements = getAdminDefinedScrollables();
    if (scrollableElements.length === 0) {
      scrollableElements = findFallbackScrollables();
    }

    // Try to scroll each scrollable element
    for (let i = 0; i < scrollableElements.length && i < 3; i++) {
      const elem = scrollableElements[i];
      let scrollCount = 0;
      const maxScrolls = 5;
      const distance = elem.clientHeight * 0.5;
      
      while (scrollCount < maxScrolls) {
        const beforeScroll = elem.scrollTop;
        elem.scrollBy(0, distance);
        await new Promise(resolve => setTimeout(resolve, 500));
        const afterScroll = elem.scrollTop;
        scrollCount++;
        
        if (beforeScroll === afterScroll) {
          break;
        }
      }
    }

    // Also try window scrolling as fallback
    let totalHeight = 0;
    let scrollCount = 0;
    const maxScrolls = 5;
    const distance = window.innerHeight * 0.5;
    const initialScrollHeight = document.body.scrollHeight;
    
    while (scrollCount < maxScrolls) {
      const beforeScroll = window.pageYOffset;
      window.scrollBy(0, distance);
      await new Promise(resolve => setTimeout(resolve, 500));
      const afterScroll = window.pageYOffset;
      totalHeight += distance;
      scrollCount++;
      
      if (beforeScroll === afterScroll) {
        break;
      }
    }

    return {
      scrollableElementsFound: scrollableElements.length,
      windowScrollCount: scrollCount,
      totalHeight,
      finalScrollHeight: document.body.scrollHeight,
      initialScrollHeight,
      finalScrollTop: window.pageYOffset || document.documentElement.scrollTop
    };
  });
}

module.exports = {
  crawlWithPuppeteer
};
