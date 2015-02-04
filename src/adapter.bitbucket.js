const
    BB_404_SEL             = '#not-yet-implemented'
  , BB_PJAX_SEL            = '#source-container'
  , BB_RESERVED_USER_NAMES = '#not-yet-implemented'
  , BB_RESERVED_REPO_NAMES = '#not-yet-implemented'

function Bitbucket() {
  if (!window.MutationObserver) return

  // Fix #151 by detecting when page layout is updated.
  // In this case, split-diff page has a wider layout, so need to recompute git.
  // Note that couldn't do this in response to URL change, since new DOM via pjax might not be ready.
  var observer = new window.MutationObserver(function(mutations) {
    for (var i = 0, len = mutations.length; i < len; i++) {
      var mutation = mutations[i]
      if (~mutation.oldValue.indexOf('split-diff') ||
          ~mutation.target.className.indexOf('split-diff')) {
        return $(document).trigger(EVENT.LAYOUT_CHANGE)
      }
    }
  })

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
    attributeOldValue: true
  })
}

/**
 * Selects a submodule.
 */
Bitbucket.prototype.selectSubmodule = function(path) {
  window.location.href = path
}

/**
 * Selects a path.
 */
Bitbucket.prototype.selectPath = function(path, tabSize) {
  var container = $(BB_PJAX_SEL)
    , qs = tabSize ? ('?ts=' + tabSize) : ''

  if (container.length) {
    $.pjax({
      // needs full path for pjax to work with Firefox as per cross-domain-content setting
      url : location.protocol + '//' + location.host + path + qs,
      container : container
    })
  }

  else window.location.href = path + qs // falls back if no container (i.e. Bitbucket DOM has changed or is not yet available)
}

/**
 * Updates page layout based on visibility status and width of the Octotree sidebar.
 */
Bitbucket.prototype.updateLayout = function(sidebarVisible, sidebarWidth) {
  var spacing = 10;
  $('html').css('margin-left', sidebarVisible ? sidebarWidth - spacing : '')
}

/**
 * Returns the repository information if user is at a repository URL. Returns `null` otherwise.
 */
Bitbucket.prototype.getRepoFromPath = function(showInNonCodePage, currentRepo) {
  // 404 page, skip
  if ($(BB_404_SEL).length) return false

  // (username)/(reponame)[/src/(commit)]
  var match = window.location.pathname.match(/([^\/]+)\/([^\/]+)(?:\/src\/)?([a-z0-9]+)?/)
  if (!match) return false

  // not a repository, skip
  if (~BB_RESERVED_USER_NAMES.indexOf(match[1])) return false
  if (~BB_RESERVED_REPO_NAMES.indexOf(match[2])) return false

  // skip non-code page or not

  var matchBranch = location.search.match(/\?at\=(.+)/);

  if (!showInNonCodePage && !matchBranch) return false

  // use selected branch, or previously selected branch, or master
  var branch = (matchBranch && matchBranch[1]) ||
    ((currentRepo.username === match[1] && currentRepo.reponame === match[2] && currentRepo.branch)
      ? currentRepo.branch
      : 'master')

  var commit = match[3] || branch

  return {
    username : match[1],
    reponame : match[2],
    commit   : commit,
    branch   : decodeURIComponent(branch)
  }
}

/**
 * Fetches data of a particular repository.
 * @param opts: { repo: repository, token (optional): user access token, apiUrl (optional): base API URL }
 * @param cb(err: error, tree: array (of arrays) of items)
 */
Bitbucket.prototype.fetchData = function(opts, cb) {
  var self = this
    , repo = opts.repo
    , folders = { '': [] }
    , encodedBranch = encodeURIComponent(decodeURIComponent(repo.commit))
    , $dummyDiv = $('<div/>')

  getTree(encodedBranch, function(err, tree) {
    if (err) return cb(err)

    fetchSubmodules(function(err, submodules) {
      if (err) return cb(err)
      submodules = submodules || {}

      // split work in chunks to prevent blocking UI on large repos
      nextChunk(0)
      function nextChunk(iteration) {
        var chunkSize = 300
          , baseIndex = iteration * chunkSize
          , i
          , item, path, type, index, name, moduleUrl, filename

        for (i = 0; i < chunkSize; i++) {
          filename = tree[baseIndex + i];

          //tree[baseIndex + i]

          // we're done
          if (filename === undefined) return cb(null, folders[''])

          item = {
            "path": filename,
            "type": filename.indexOf('/', filename.length - 1) !== -1 ? 'tree' : 'blob',
          };

          if (item.type === 'tree') {
            item.path = item.path.substring(0, item.path.lastIndexOf('/'));
          }

          path  = item.path
          type  = item.type
          index = path.lastIndexOf('/')
          name  = $dummyDiv.text(path.substring(index + 1)).html() // sanitizes, closes #9

          item.id   = PREFIX + path
          item.text = name
          item.icon = type // use `type` as class name for tree node

          folders[path.substring(0, index)].push(item)

          if (type === 'tree') {
            folders[item.path] = item.children = []
            item.a_attr = { href: '#' }
          }
          else if (type === 'blob') {
            item.a_attr = { href: '/' + repo.username + '/' + repo.reponame + '/src/' + repo.commit + '/' + path + '?at=' + repo.branch /* closes #97 */ }
          }
          /* TODO: submodules */
        }

        setTimeout(function() {
          nextChunk(iteration + 1)
        }, 0)
      }
    })

    function fetchSubmodules(cb) {
      /* TODO: submodules */
      return cb();
    }
  })

  function getTree(tree, cb) {
   get('/directory/' + tree, function(err, res) {
      if (err) return cb(err)
      cb(null, res.values)
    })
  }

  function getBlob(sha, cb) {
    /* TODO */
  }

  function get(path, cb) {
    var token = opts.token
      , host  = (location.host === 'bitbucket.org' ? location.host + '/!api/1.0' : location.host )
      , base  = location.protocol + '//' + host + '/repositories/' + repo.username + '/' + repo.reponame
      , cfg   = { method: 'GET', url: base + path, cache: false }

    if (token) cfg.headers = { Authorization: 'token ' + token }
    $.ajax(cfg)
      .done(function(data) {
        cb(null, data)
      })
      .fail(function(jqXHR) {
        /* TODO: Properly handle errors */
        var error = jqXHR.statusText
          , message = jqXHR.statusText
          , needAuth = false;

        cb({
          error    : 'Error: ' + error,
          message  : message,
          needAuth : needAuth,
        })
      })
  }
}