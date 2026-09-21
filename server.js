const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================
// ROTA PRINCIPAL DE SCRAPING
// ============================================
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  console.log('=== Nova requisicao ===');
  console.log('URL:', url);

  if (!url) return res.status(400).json({ error: 'URL obrigatorio' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL invalido' });

  let browser;
  try {
    console.log('A iniciar browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio'
      ]
    });
    console.log('Browser iniciado com sucesso');

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });

    console.log('A navegar para:', url);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    console.log('Pagina carregada. A aguardar JS...');

    await new Promise(r => setTimeout(r, 3000));

    await page.evaluate(() => window.scrollTo(0, 400));
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => window.scrollTo(0, 0));

    const host = new URL(url).hostname;
    let data = {};

    if (host.includes('beforward')) data = await scrapeBeforward(page);
    else if (host.includes('sbtjapan')) data = await scrapeSBTJapan(page);
    else if (host.includes('sbt')) data = await scrapeSBT(page);
    else data = await scrapeGeneric(page);

    console.log('Dados extraidos:', JSON.stringify(data).substring(0, 200));

    data.sourceUrl = url;
    res.json(data);
  } catch (err) {
    console.error('=== SCRAPE ERROR ===');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// ============================================
// BEFORWARD
// ============================================
async function scrapeBeforward(page) {
  return await page.evaluate(() => {
    const txt = s => document.querySelector(s)?.innerText?.trim() || null;
    const meta = n => document.querySelector(`meta[property="${n}"]`)?.content || document.querySelector(`meta[name="${n}"]`)?.content || null;

    let rawTitle = document.title || '';
    let title = rawTitle.replace(/\s*\|\s*BE\s*FORWARD.*$/i, '').replace(/\s*\|\s*.*$/i, '').replace(/\s+for sale.*$/i, '').replace(/\s+used.*$/i, '').replace(/\s+/g, ' ').trim();

    if (!title || /^\d{4}$/.test(title)) {
      const h1 = txt('.vehicle-title') || txt('h1') || '';
      if (h1 && h1.length > 3) title = h1;
    }

    const BRANDS = ['Toyota','Honda','Nissan','Mazda','Mitsubishi','Subaru','Suzuki','Isuzu','Lexus','BMW','Mercedes-Benz','Mercedes','Audi','Volkswagen','VW','Ford','Chevrolet','Hyundai','Kia','Peugeot','Renault','Volvo','Jaguar','Porsche','Fiat','Daihatsu','Jeep','Dodge','Chrysler','Land Rover','Range Rover','Mini','Alfa Romeo','Tesla','BYD','Hino','Mack','Scania','MAN','Iveco','DAF'];

    let brand = null, model = null;
    for (const b of BRANDS) {
      const re = new RegExp('\\b' + b.replace(/[-]/g, '\\-') + '\\b', 'i');
      if (re.test(title)) {
        brand = b;
        model = title.replace(re, '').replace(/\b(19|20)\d{2}\b/, '').replace(/\s+/g, ' ').trim();
        break;
      }
    }
    if (!brand && title) {
      const parts = title.split(/\s+/);
      brand = parts[0];
      model = parts.slice(1).join(' ');
    }

    let year = parseInt((title.match(/\b(19|20)\d{2}\b/) || [])[0]) || null;
    if (!year) {
      const m = (document.title.match(/\b(19|20)\d{2}\b/) || [])[0];
      if (m) year = parseInt(m);
    }

    const bodyText = document.body.innerText;
    let cc = null;
    const ccPatterns = [
      /(\d{1,2}[.,\s]\d{3}|\d{3,4})\s*cc\b/i,
      /(\d{1,2}[.,\s]\d{3}|\d{3,4})cc/i,
      /(\d[.,]\d)\s*[lL]\b/,
      /(?:displacement|engine|cilindrada|motor|engine size)[^\d]{0,20}(\d{1,2}[.,\s]\d{3}|\d{3,4})/i,
      /(?:^|\s)(\d{1,2}[.,]\d{3})(?:\s|$)/,
      /\b(\d{3,4})\b/
    ];
    for (const pattern of ccPatterns) {
      const m = bodyText.match(pattern);
      if (!m || !m[1]) continue;
      let val = m[1];
      if (/^\d[.,]\d$/.test(val)) cc = Math.round(parseFloat(val.replace(',', '.')) * 1000);
      else cc = parseInt(val.replace(/[.,\s]/g, ''));
      if (cc >= 600 && cc <= 6000) break;
      cc = null;
    }

    let price = null;
    const priceMatch = document.body.innerText.match(/US\$\s*([\d,]+)/i) || document.body.innerText.match(/USD\s*([\d,]+)/i) || document.body.innerText.match(/\$\s*([\d,]+)/);
    if (priceMatch) price = parseFloat(priceMatch[1].replace(/,/g, ''));

    let image = null;
    const imgSelectors = ['meta[property="og:image"]','meta[name="twitter:image"]','.vehicle-image img','.main-image img','.swiper-slide img','[class*="gallery"] img','[class*="photo"] img','img[src*="/vehicle"]','img[src*="/stock"]'];
    for (const sel of imgSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      let src = el.tagName === 'META' ? el.content : (el.src || el.dataset.src || el.getAttribute('data-lazy-src'));
      if (!src) continue;
      if (!src.startsWith('http')) { try { src = new URL(src, location.origin).href; } catch (e) { continue; } }
      if (/logo|icon|banner|sprite|flag|pixel/i.test(src)) continue;
      image = src;
      break;
    }

    return { brand: brand || null, model: model || null, year: year, cc: cc, price: price, currency: 'USD', image: image, country: 'JP' };
  });
}

// ============================================
// SBT JAPAN (sbtjapan.com)
// ============================================
async function scrapeSBTJapan(page) {
  return await page.evaluate(() => {
    const txt = s => document.querySelector(s)?.innerText?.trim() || null;
    const meta = n => document.querySelector(`meta[property="${n}"]`)?.content || document.querySelector(`meta[name="${n}"]`)?.content || null;

    const urlParts = location.pathname.split('/').filter(Boolean);
    const usedCarsIdx = urlParts.indexOf('used-cars');
    let urlBrand = null, urlModel = null;
    if (usedCarsIdx >= 0 && urlParts[usedCarsIdx + 1] && urlParts[usedCarsIdx + 2]) {
      const capitalize = s => s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      urlBrand = capitalize(urlParts[usedCarsIdx + 1]);
      urlModel = capitalize(urlParts[usedCarsIdx + 2]);
      if (urlBrand === 'Mercedes Benz') urlBrand = 'Mercedes-Benz';
    }

    let title = meta('og:title') || txt('h1') || document.title || '';
    title = title.replace(/^SBT\s+\d{4}\s*/i, '').replace(/\s*\|\s*SBT.*$/i, '').replace(/\s*-\s*SBT.*$/i, '').replace(/\s+/g, ' ').trim();

    const BRANDS = ['Toyota','Honda','Nissan','Mazda','Mitsubishi','Subaru','Suzuki','Isuzu','Lexus','BMW','Mercedes-Benz','Mercedes','Audi','Volkswagen','VW','Ford','Chevrolet','Hyundai','Kia','Peugeot','Renault','Volvo','Jaguar','Porsche','Fiat','Daihatsu','Jeep','Dodge','Chrysler','Land Rover','Range Rover','Mini','Alfa Romeo','Tesla','BYD','Hino','Mack','Scania','MAN','Iveco','DAF','Opel','Seat','Skoda','Citroen','Citroën','Smart','Infiniti','Acura','Genesis','Chery','Great Wall','Haval','MG','SsangYong'];

    let brand = urlBrand;
    let model = urlModel;
    if (!brand) {
      for (const b of BRANDS) {
        const re = new RegExp('\\b' + b.replace(/[-]/g, '\\-') + '\\b', 'i');
        if (re.test(title)) { brand = b; model = title.replace(/\b(19|20)\d{2}\b/g, '').replace(re, '').replace(/\s+/g, ' ').trim(); break; }
      }
    }
    if (!brand && title) { const parts = title.split(/\s+/); brand = parts[0] || null; model = parts.slice(1).join(' ') || null; }

    let year = parseInt((title.match(/\b(19|20)\d{2}\b/) || [])[0]) || null;
    if (!year) { const m = (document.body.innerText.match(/\b(19|20)\d{2}\b/) || [])[0]; if (m) year = parseInt(m); }

    const bodyText = document.body.innerText;
    let cc = null;
    const ccPatterns = [/(\d{1,2}[.,\s]\d{3}|\d{3,4})\s*cc\b/i, /(\d{1,2}[.,\s]\d{3}|\d{3,4})cc/i, /(\d[.,]\d)\s*[lL]\b/, /(?:engine|motor|displacement)[^\d]{0,20}(\d{1,2}[.,\s]\d{3}|\d{3,4})/i];
    for (const p of ccPatterns) {
      const m = bodyText.match(p);
      if (!m || !m[1]) continue;
      let val = m[1];
      if (/^\d[.,]\d$/.test(val)) cc = Math.round(parseFloat(val.replace(',', '.')) * 1000);
      else cc = parseInt(val.replace(/[.,\s]/g, ''));
      if (cc >= 600 && cc <= 8000) break;
      cc = null;
    }

    let price = null;
    const priceMatch = bodyText.match(/USD\s*([\d,]+)/i) || bodyText.match(/US\$\s*([\d,]+)/i) || bodyText.match(/\$\s*([\d,]+)/);
    if (priceMatch) price = parseFloat(priceMatch[1].replace(/,/g, ''));

    let image = meta('og:image') || meta('twitter:image') || null;
    if (!image) {
      const imgSelectors = ['.main-image img','.vehicle-image img','.gallery img','[class*="gallery"] img','[class*="photo"] img','[class*="slider"] img'];
      for (const sel of imgSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        let src = el.src || el.dataset.src || el.getAttribute('data-lazy-src');
        if (!src) continue;
        if (!src.startsWith('http')) { try { src = new URL(src, location.origin).href; } catch (e) { continue; } }
        if (/logo|icon|banner|sprite|flag|pixel/i.test(src)) continue;
        image = src;
        break;
      }
    }

    return { brand: brand || null, model: model || null, year: year, cc: cc, price: price, currency: 'USD', image: image, country: 'JP' };
  });
}

// ============================================
// SBT MOCAMBIQUE (sbt.co.mz)
// ============================================
async function scrapeSBT(page) {
  return await page.evaluate(() => {
    const txt = s => document.querySelector(s)?.innerText?.trim() || null;
    const meta = n => document.querySelector(`meta[property="${n}"]`)?.content || document.querySelector(`meta[name="${n}"]`)?.content || null;

    let rawTitle = document.title || '';
    let title = rawTitle.replace(/\s*\|\s*SBT.*$/i, '').replace(/\s*-\s*SBT.*$/i, '').replace(/\s*\|\s*.*$/i, '').replace(/\s+em venda.*$/i, '').replace(/\s+à venda.*$/i, '').replace(/\s+usado.*$/i, '').replace(/\s+/g, ' ').trim();
    if (!title || title.length < 3) { const h1 = txt('h1'); if (h1) title = h1; }

    const BRANDS = ['Toyota','Honda','Nissan','Mazda','Mitsubishi','Subaru','Suzuki','Isuzu','Lexus','BMW','Mercedes-Benz','Mercedes','Audi','Volkswagen','VW','Ford','Chevrolet','Hyundai','Kia','Peugeot','Renault','Volvo','Jaguar','Porsche','Fiat','Daihatsu','Jeep','Dodge','Chrysler','Land Rover','Range Rover','Mini','Alfa Romeo','Tesla','BYD'];

    let brand = null, model = null;
    for (const b of BRANDS) {
      const re = new RegExp('\\b' + b.replace(/[-]/g, '\\-') + '\\b', 'i');
      if (re.test(title)) { brand = b; model = title.replace(re, '').replace(/\b(19|20)\d{2}\b/, '').replace(/\s+/g, ' ').trim(); break; }
    }
    if (!brand && title) { const parts = title.split(/\s+/); brand = parts[0]; model = parts.slice(1).join(' '); }

    let year = parseInt((title.match(/\b(19|20)\d{2}\b/) || [])[0]) || null;
    if (!year) { const m = (document.body.innerText.match(/\b(19|20)\d{2}\b/) || [])[0]; if (m) year = parseInt(m); }

    const bodyText = document.body.innerText;
    let cc = null;
    const ccPatterns = [/(\d{1,2}[.,\s]\d{3}|\d{3,4})\s*cc\b/i, /(\d{1,2}[.,\s]\d{3}|\d{3,4})cc/i, /(\d[.,]\d)\s*[lL]\b/, /(?:displacement|engine|cilindrada|motor|engine size)[^\d]{0,20}(\d{1,2}[.,\s]\d{3}|\d{3,4})/i];
    for (const pattern of ccPatterns) {
      const m = bodyText.match(pattern);
      if (!m || !m[1]) continue;
      let val = m[1];
      if (/^\d[.,]\d$/.test(val)) cc = Math.round(parseFloat(val.replace(',', '.')) * 1000);
      else cc = parseInt(val.replace(/[.,\s]/g, ''));
      if (cc >= 600 && cc <= 6000) break;
      cc = null;
    }

    let price = null;
    const priceMatch = bodyText.match(/([\d][\d\s.,]{3,})\s*(MT|MZN|Meticais)/i);
    if (priceMatch) { const digits = priceMatch[1].replace(/\D/g, ''); if (digits) price = parseInt(digits); }

    let image = meta('og:image') || meta('twitter:image') || null;
    if (!image) {
      const imgSelectors = ['.main-image img','.gallery img','[class*="gallery"] img','[class*="photo"] img','[class*="slider"] img','img[src*="vehicle"]','img[src*="car"]','img[src*="auto"]'];
      for (const sel of imgSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        let src = el.src || el.dataset.src || el.getAttribute('data-lazy-src');
        if (!src) continue;
        if (!src.startsWith('http')) { try { src = new URL(src, location.origin).href; } catch (e) { continue; } }
        if (/logo|icon|banner|sprite|flag|pixel/i.test(src)) continue;
        image = src;
        break;
      }
    }

    return { brand: brand || null, model: model || null, year: year, cc: cc, price: price, currency: 'MZN', image: image, country: 'MZ' };
  });
}

// ============================================
// GENÉRICO MELHORADO
// ============================================
async function scrapeGeneric(page) {
  return await page.evaluate(() => {
    const txt = s => document.querySelector(s)?.innerText?.trim() || null;
    const meta = n => document.querySelector(`meta[property="${n}"]`)?.content || document.querySelector(`meta[name="${n}"]`)?.content || null;

    let jsonLdData = null;
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of jsonLdScripts) {
      try {
        const parsed = JSON.parse(s.textContent);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of arr) {
          const type = item['@type'] || '';
          if (/Vehicle|Car|Product|Offer|ItemPage/i.test(type)) { jsonLdData = item; break; }
          if (item['@graph'] && Array.isArray(item['@graph'])) {
            for (const sub of item['@graph']) { if (/Vehicle|Car|Product|Offer/i.test(sub['@type'] || '')) { jsonLdData = sub; break; } }
          }
          if (jsonLdData) break;
        }
        if (jsonLdData) break;
      } catch (e) {}
    }

    const rawTitle = document.title || '';
    const ogTitle = meta('og:title') || meta('twitter:title') || '';
    const ogDesc = meta('og:description') || meta('twitter:description') || '';
    const h1 = txt('h1') || '';
    const bodyText = document.body.innerText || '';
    const combined = [ogTitle, h1, rawTitle, ogDesc].filter(Boolean).join(' | ');

    const BRANDS = ['Toyota','Honda','Nissan','Mazda','Mitsubishi','Subaru','Suzuki','Isuzu','Lexus','BMW','Mercedes-Benz','Mercedes','Audi','Volkswagen','VW','Ford','Chevrolet','Hyundai','Kia','Peugeot','Renault','Volvo','Jaguar','Porsche','Fiat','Daihatsu','Jeep','Dodge','Chrysler','Land Rover','Range Rover','Mini','Alfa Romeo','Tesla','BYD','Hino','Mack','Scania','MAN','Iveco','DAF','Opel','Seat','Skoda','Citroen','Citroën','Smart','Infiniti','Acura','Genesis','Chery','Great Wall','Haval','MG','SsangYong'];

    let brand = null, model = null;
    if (jsonLdData) {
      brand = jsonLdData.brand?.name || jsonLdData.brand || null;
      model = jsonLdData.model || jsonLdData.name || null;
      if (typeof brand === 'object') brand = brand.name || null;
      if (typeof model === 'object') model = model.name || null;
    }
    if (!brand) {
      for (const b of BRANDS) {
        const re = new RegExp('\\b' + b.replace(/[-]/g, '\\-') + '\\b', 'i');
        if (re.test(combined)) {
          brand = b;
          const match = combined.match(re);
          if (match) {
            const after = combined.substring(match.index + match[0].length);
            model = after.replace(/^\s*[-:|·]\s*/, '').replace(/\b(19|20)\d{2}\b/, '').split(/[|·\-–—:,]/)[0].trim().substring(0, 40);
          }
          break;
        }
      }
    }
    if (!brand && combined) {
      const first = combined.split(/\s+/)[0];
      if (first && first.length > 2) {
        brand = first.replace(/[^\w\-]/g, '');
        model = combined.split(/\s+/).slice(1, 4).join(' ').replace(/[|·\-–—:,]/g, '').trim();
      }
    }

    let year = null;
    const yearSources = combined + ' ' + bodyText.substring(0, 3000);
    const yearMatch = yearSources.match(/\b(19[89]\d|20[0-3]\d)\b/);
    if (yearMatch) year = parseInt(yearMatch[1]);

    let cc = null;
    const ccPatterns = [/(\d{1,2}[.,\s]\d{3}|\d{3,4})\s*cc\b/i, /(\d{1,2}[.,\s]\d{3}|\d{3,4})cc/i, /(\d[.,]\d)\s*[lL]\b/, /(?:displacement|engine|cilindrada|motor|engine size|moteur|cilindree)[^\d]{0,20}(\d{1,2}[.,\s]\d{3}|\d{3,4})/i, /(?:^|\s)(\d{1,2}[.,]\d{3})(?:\s|$)/, /\b(\d{3,4})\b/];
    for (const pattern of ccPatterns) {
      const m = bodyText.match(pattern);
      if (!m || !m[1]) continue;
      let val = m[1];
      if (/^\d[.,]\d$/.test(val)) cc = Math.round(parseFloat(val.replace(',', '.')) * 1000);
      else cc = parseInt(val.replace(/[.,\s]/g, ''));
      if (cc >= 600 && cc <= 8000) break;
      cc = null;
    }

    let price = null;
    let currency = 'USD';
    if (jsonLdData) {
      if (jsonLdData.offers) {
        const offer = Array.isArray(jsonLdData.offers) ? jsonLdData.offers[0] : jsonLdData.offers;
        if (offer.price) { price = parseFloat(String(offer.price).replace(/[^\d.]/g, '')); if (offer.priceCurrency) currency = offer.priceCurrency; }
      }
      if (!price && jsonLdData.price) { price = parseFloat(String(jsonLdData.price).replace(/[^\d.]/g, '')); if (jsonLdData.priceCurrency) currency = jsonLdData.priceCurrency; }
    }
    if (!price) {
      const pricePatterns = [/US\$\s*([\d,]+)/i, /USD\s*([\d,.]+)/i, /€\s*([\d.,]+)/, /MZN\s*([\d.,]+)/i, /([\d.,]{3,})\s*(MZN|MT|Meticais)/i, /([\d,.]+)\s*USD/i, /([\d.,]+)\s*EUR/i, /\$\s*([\d,]+)/, /€\s*([\d.,]+)/, /([\d.,]{4,})/];
      for (const p of pricePatterns) {
        const m = bodyText.match(p);
        if (m && m[1]) {
          const cleaned = m[1].replace(/[,]/g, '').replace(/(\.\d{2})$/, '.$1');
          const val = parseFloat(cleaned) || parseInt(m[1].replace(/\D/g, ''));
          if (val > 100) {
            price = val;
            const full = m[0].toLowerCase();
            if (full.includes('eur') || full.includes('€')) currency = 'EUR';
            else if (full.includes('mzn') || full.includes('mt')) currency = 'MZN';
            break;
          }
        }
      }
    }

    let image = meta('og:image') || meta('twitter:image') || null;
    if (jsonLdData && jsonLdData.image) {
      if (typeof jsonLdData.image === 'string') image = jsonLdData.image;
      else if (jsonLdData.image.url) image = jsonLdData.image.url;
    }
    if (!image) {
      const imgSelectors = ['[class*="main-image"] img','[class*="gallery"] img','[class*="photo"] img','[class*="slider"] img','article img','main img','img[src*="vehicle"]','img[src*="car"]','img[src*="auto"]'];
      for (const sel of imgSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          let src = el.src || el.dataset.src || el.getAttribute('data-lazy-src') || el.getAttribute('data-original');
          if (!src) continue;
          if (!src.startsWith('http')) { try { src = new URL(src, location.origin).href; } catch (e) { continue; } }
          if (/logo|icon|banner|sprite|flag|pixel|avatar|1x1|placeholder/i.test(src)) continue;
          if (el.naturalWidth && el.naturalWidth < 150) continue;
          image = src;
          break;
        }
        if (image) break;
      }
    }

    let country = null;
    const host = location.hostname;
    if (/\.jp$|japan/i.test(host)) country = 'JP';
    else if (/\.za$|south africa/i.test(host)) country = 'ZA';
    else if (/\.uk$|united kingdom/i.test(host)) country = 'UK';
    else if (/\.ae$|emirates/i.test(host)) country = 'AE';
    else if (/\.mz$|mozambique/i.test(host)) country = 'MZ';

    return { brand: brand || null, model: model ? model.substring(0, 50) : null, year: year, cc: cc, price: price, currency: currency, image: image, country: country };
  });
}

// ============================================
// ARRANQUE
// ============================================
app.listen(PORT, () => {
  console.log('');
  console.log('Servidor a correr!');
  console.log('Abre no browser: http://localhost:3000');
  console.log('API de scraping: http://localhost:3000/api/scrape');
  console.log('');
});