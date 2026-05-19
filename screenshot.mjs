import puppeteer from 'puppeteer';
import path from 'path';
const [,, demoPath, outputPath] = process.argv;
const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 800 });
await page.goto(`file://${path.resolve(demoPath)}`);
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: outputPath });
await browser.close();
console.log('done:', outputPath);
