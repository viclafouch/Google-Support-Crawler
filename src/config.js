export const baseUrl = new URL('https://support.google.com')
export const limit = 10

export const products = [
  {
    name: 'YouTube',
    url: baseUrl.origin + '/youtube/'
  },
  {
    name: 'Chrome',
    url: baseUrl.origin + '/chrome/'
  },
  {
    name: 'Gmail',
    url: baseUrl.origin + '/mail/'
  },
  {
    name: 'Adsense',
    url: baseUrl.origin + '/adsense/'
  },
  {
    name: 'Google Search',
    url: baseUrl.origin + '/websearch/'
  },
  {
    name: 'Google Photos',
    url: baseUrl.origin + '/photos/'
  },
  {
    name: 'Google Maps',
    url: baseUrl.origin + '/maps/'
  }
]

export const languages = ['fr', 'en', 'es', 'de', 'pt']

export const maxThreads = [8, 15, 30]
