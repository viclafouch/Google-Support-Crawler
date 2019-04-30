import { retryRequest } from '../utils/utils'
import fetch from 'node-fetch'
import cheerio from 'cheerio'
const _cliProgress = require('cli-progress')

class Crawler {
  constructor(options) {
    this._options = Object.assign(
      {},
      {
        titleProgress: 'Crawl in progress',
        showProgress: true,
        maxRequest: 3,
        skipStrictDuplicates: true,
        sameOrigin: true,
        maxDepth: 3,
        parallel: 5
      },
      options
    )
    this._requestedCount = 0
    this.hostdomain = ''
    this.linksToCrawl = new Map()
    this.linksCrawled = new Map()
    this._actions = {
      preRequest: this._options.preRequest || (x => x),
      onSuccess: this._options.onSuccess || null,
      evaluatePage: this._options.evaluatePage || null
    }
    this.progressCli = null
  }

  /**
   * Init the app. Begin with the first link, and start the pulling
   * @return {!Promise<pending>}
   */
  async init() {
    try {
      const link = new URL(this._options.url)
      this.hostdomain = link.origin
    } catch (error) {
      throw new Error('URL provided is not valid')
    }

    if (!this.hostdomain) return
    const sanitizedUrl = await this.shouldRequest(this._options.url)
    if (!sanitizedUrl) return
    const { linksCollected } = await this.scrapePage(sanitizedUrl)
    this.linksCrawled.set(sanitizedUrl)
    this._requestedCount++
    if (linksCollected.length === 0) return
    if (this._options.showProgress) {
      this.progressCli = new _cliProgress.Bar(
        {
          format: `${this._options.titleProgress} [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} | Speed: {speed} kbit`
        },
        _cliProgress.Presets.rect
      )
    }
    await this.addToQueue(linksCollected, 1)
    if (this.linksToCrawl.size > 0) {
      this._options.showProgress && this.progressCli.start(this.linksToCrawl.size, 0)
      return this.crawl()
    }
  }

  /**
   * Get all links from the page except the actual location
   * @param {!Page} page
   * @return {!Promise<Array<string>>}
   */
  collectAnchors($, actualHref) {
    const { origin, protocol } = new URL(actualHref)
    const allLinks = $('a')
      .map((i, e) => {
        const href = $(e).attr('href') || ''
        if (href.startsWith('//')) return protocol + href
        else if (href.startsWith('/')) return origin + href
        else return href
      })
      .filter((i, href) => {
        try {
          return !!new URL(href)
        } catch (error) {
          return false
        }
      })
      .get()
    return [...new Set(allLinks)]
  }

  /**
   * Check if link can be crawled (Same origin ? Already collected ? preRequest !false ?)
   * @param {!string} link
   * @return {!Promise<Boolean>}
   */
  async skipRequest(link) {
    const allowOrigin = this.checkSameOrigin(link)
    if (!allowOrigin) return true
    if (this._options.skipStrictDuplicates && this.linkAlreadyCollected(link)) return true
    const shouldRequest = await this.shouldRequest(link)
    if (!shouldRequest) return true
    return false
  }

  /**
   * If preRequest is provided by the user, get new link or false
   * @param {!string} link
   * @return {!Promise<String || Boolean>}
   */
  async shouldRequest(link) {
    if (this._actions.preRequest instanceof Function) {
      try {
        const preRequest = await this._actions.preRequest(link)
        if (typeof preRequest === 'string' || preRequest === false) {
          return preRequest
        }
        throw new Error('preRequest function must return a string or false')
      } catch (error) {
        console.error('Please try/catch your preRequest function')
        console.log(error.message)
      }
    }
    return link
  }

  /**
   * Check if link has the same origin as the host link
   * @param {!String} url
   * @return {!Boolean}
   */
  checkSameOrigin(url) {
    if (this._options.sameOrigin) return new URL(url).origin === this.hostdomain
    return true
  }

  /**
   * If evaluatePage is provided by the user, await for it
   * @param {!Page} page
   * @return {!Promise<any>}
   */
  async evaluate($) {
    let result = null
    if (this._actions.evaluatePage && this._actions.evaluatePage instanceof Function) {
      result = await this._actions.evaluatePage($)
    }
    return result
  }

  /**
   * Add links collected to queue
   * @param {!Array<string>} urlCollected
   * @param {!Number} depth
   * @return {!Promise<pending>}
   */
  async addToQueue(urlCollected, depth = 0) {
    for (let url of urlCollected) {
      if (depth <= this._options.maxDepth && !(await this.skipRequest(url))) {
        url = await this.shouldRequest(url)
        this.linksToCrawl.set(url, depth)
        this._options.showProgress && this.progressCli.setTotal(this.linksToCrawl.size)
      }
    }
  }

  crawl() {
    return new Promise((resolve, reject) => {
      let canceled = false
      let currentCrawlers = 0
      const pullQueue = () => {
        if (canceled) return
        while (currentCrawlers < this._options.parallel && this.linksToCrawl.size > 0) {
          currentCrawlers++
          const currentLink = this.linksToCrawl.keys().next().value
          const currentDepth = this.linksToCrawl.get(currentLink)
          this.linksToCrawl.delete(currentLink)
          this.linksCrawled.set(currentLink)
          // debug(`je crawl ${currentLink}`)
          this.pull(currentLink, currentDepth)
            .then(() => {
              this._options.showProgress && this.progressCli.update(this.linksCrawled.size)
              currentCrawlers--
              if (currentCrawlers === 0 && this.linksToCrawl.size === 0) resolve()
              else pullQueue()
            })
            .catch(error => {
              canceled = true
              reject(error)
            })
        }
      }
      pullQueue()
    })
  }

  async pull(link, depth) {
    try {
      const { result, linksCollected } = await this.scrapePage(link)
      await this.scrapeSucceed({ urlScraped: link, result })
      await this.addToQueue(linksCollected, depth + 1)
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Get if a link will be crawled or has already been crawled.
   * @param {!String} url
   * @return {!Boolean}
   */
  linkAlreadyCollected(url) {
    return this.linksCrawled.has(url) || this.linksToCrawl.has(url)
  }

  /**
   * Know if we have exceeded the number of request max provided in the options.
   * @return {!Boolean}
   */
  checkMaxRequest() {
    if (this._options.maxRequest === -1) return true
    return this.linksToCrawl.size < this._options.maxRequest
  }

  /**
   * If onSuccess action's has been provided, await for it.
   * @param {!Object<{urlScraped: string, result}>}
   * @return {!Promise<pending>}
   */
  async scrapeSucceed({ urlScraped, result }) {
    if (this._actions.onSuccess && this._actions.onSuccess instanceof Function) {
      try {
        await this._actions.onSuccess({ result, url: urlScraped })
      } catch (error) {
        console.error('Please try/catch your onSuccess function')
      }
    }
  }

  /**
   * Scrap a page, evaluate and get new links to visit.
   * @param {!String} url
   * @return {Promise<{linksCollected: array, result, url: string}>}
   */
  async scrapePage(url) {
    const retriedFetch = retryRequest(fetch, 2)
    try {
      const textBuffer = await retriedFetch(url)
      const textResponse = await textBuffer.text()
      const $ = cheerio.load(textResponse)
      const [result, linksCollected] = await Promise.all([this.evaluate($), this.collectAnchors($, url)])
      return { linksCollected, result, url }
    } catch (error) {
      console.error('I am 💩')
    }
  }

  /**
   * Starting the crawl.
   * @param {!0bject} options
   * @return {Promise<{startCrawlingAt: date, finishCrawlingAt: date, linksVisited: array}>}
   */
  static async launch(options) {
    const startCrawlingAt = new Date()
    const crawler = new Crawler(options)
    await crawler.init()
    const finishCrawlingAt = new Date()
    return { startCrawlingAt, finishCrawlingAt, linksVisited: crawler.linksCrawled.size }
  }
}

export default Crawler
