/* eslint-disable no-console */
/* global $ _ Backbone */

// Home Sweet Global Namespace
var sf = {};

// Minimal audio helper: play a short pulsed loop for a duration (default 3s)
sf.audio = (function() {
  const api = {
    enabled: true,
    src: '/audio/splitflap.mp3',
    _ctx: null,
    _buffer: null,
    _gain: null,
    _pulseSource: null,
    _pulseTimer: null,
    pulseDurationMs: 5000,
    _fadeDurationMs: 400,

    init: async function() {
      if (this._ctx) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      try {
        this._ctx = new AudioContext();
        this._gain = this._ctx.createGain();
        this._gain.gain.value = 0.12;
        this._gain.connect(this._ctx.destination);

        const resp = await fetch(this.src);
        const ab = await resp.arrayBuffer();
        try {
          this._buffer = await this._ctx.decodeAudioData(ab);
        } catch (e) {
          this._buffer = await new Promise((resolve, reject) => {
            this._ctx.decodeAudioData(ab, resolve, reject);
          });
        }

        // Resume on first gesture if browser blocks autoplay
        const resume = async () => {
          try { if (this._ctx.state === 'suspended') await this._ctx.resume(); } catch (e) {}
          document.removeEventListener('click', resume);
          document.removeEventListener('keydown', resume);
        };
        document.addEventListener('click', resume, { once: true });
        document.addEventListener('keydown', resume, { once: true });
      } catch (e) {
        console.warn('sf.audio.init failed', e);
      }
    },

    // Play a looping pulse for `durationMs`, then fade out and stop
    pulse: async function(durationMs) {
      durationMs = typeof durationMs === 'number' ? durationMs : this.pulseDurationMs;
      try {
        await this.init();
        if (!this._ctx || !this._buffer || !this._gain) return;
        if (this._ctx.state === 'suspended') {
          try { await this._ctx.resume(); } catch (e) {}
        }

        // clear existing pulse if present
        if (this._pulseTimer) {
          clearTimeout(this._pulseTimer);
          this._pulseTimer = null;
        }

        if (!this._pulseSource) {
          const src = this._ctx.createBufferSource();
          src.buffer = this._buffer;
          src.loop = true;
          src.connect(this._gain);
          try { src.start(0); } catch (e) {}
          this._pulseSource = src;
        }

        // restore gain quickly
        try { this._gain.gain.cancelScheduledValues(this._ctx.currentTime); } catch (e) {}
        try { this._gain.gain.setValueAtTime(0.12, this._ctx.currentTime); } catch (e) {}

        // schedule fade out to start AFTER the requested duration, then stop after fade
        const fadeMs = this._fadeDurationMs;
        const stopAfter = Math.max(0, durationMs); // ms to play at full volume
        // start fade only after the full-duration has elapsed
        const fadeStartSec = this._ctx.currentTime + (stopAfter / 1000);
        try {
          this._gain.gain.cancelScheduledValues(this._ctx.currentTime);
          this._gain.gain.setValueAtTime(this._gain.gain.value || 0.12, this._ctx.currentTime);
          this._gain.gain.linearRampToValueAtTime(0, fadeStartSec + (fadeMs / 1000));
        } catch (e) {}

        const self = this;
        // stop after the duration plus fade time (plus a small buffer)
        this._pulseTimer = setTimeout(() => {
          try {
            if (self._pulseSource) {
              try { self._pulseSource.stop(0); } catch (e) {}
              try { self._pulseSource.disconnect(); } catch (e) {}
              self._pulseSource = null;
            }
          } catch (e) {}
          if (self._pulseTimer) { clearTimeout(self._pulseTimer); self._pulseTimer = null; }
        }, stopAfter + fadeMs + 50);
      } catch (e) {
        // ignore
      }
    }
  };

  return api;
})();

// Namespace for objects defined and used locally in templates
sf.local = {};

// Namespace for plugin-specific javascript,
// to be loaded later in separate files
sf.plugins = {};

/* ********************************************************************* */
/* HOUSEKEEPING                                                          */

Array.prototype.rotate = (() => {
  let unshift = Array.prototype.unshift,
    splice = Array.prototype.splice;
  return function(count) {
    let len = this.length >>> 0;
    count = count >> 0;
    unshift.apply(this, splice.call(this, count % len, len));
    return this;
  };
})();

/* ********************************************************************* */
/* BACKBONE COLLECTIONS, MODELS AND VIEWS                                */

// This View generates the empty markup for the rows
// It is only called once, at document.ready()
// By default it sets 12 rows. Set sf.options.numRows to change this.
sf.Board = Backbone.View.extend({
  render: function() {
    this.el.find('.row').remove();
    for (var i = 0; i < sf.options.numRows; i++) {
      this.el.append(this.template());
    }
    this.el.find('.row').each((idx, row) => {
      sf.display.initRow($(row));
    });
  }
});

sf.board = {
  // Generate the markup for and initialize a blank board
  init: options => {
    let board = new sf.Board();
    board.el = options.container;
    board.template = _.template(options.template.html());
    sf.options.numRows = sf.options.numRows ? sf.options.numRows : 5; // default 12 rows
    board.render();
  },

  // Utility method to reset the board.
  // It goes through every group in every row,
  // calling loadGroup() with an empty string.
  // When it gets to the last row it reloads the page.
  reset: () => {
    console.log('Resetting Board');
    // audio on station change only
    const stagger = sf.options.stagger ? sf.options.stagger : 1000;
    const rows = sf.options.container.find('.row');
    let i = 0;
    const loop = function() {
      setTimeout(function() {
        sf.board.clearRow(rows[i]);
        i++;
        if (i < rows.length) {
          loop(i);
        } else {
          // give it 10 seconds to finish clearing
          // the board, then reload the page.
          setTimeout(function() {
            window.location.reload();
          }, 10000);
        }
      }, stagger);
    };
    loop();
  },

  // Clears an individual row
  clearRow: function(row) {
    var groups = $(row).find('.group');
    groups.each(function() {
      sf.display.loadGroup(' ', $(this));
    });
  }
};

// This Collection is used to hold the datset for this board.
// If there's more results than rows, it will page the results
// at options.pageInterval.
sf.Items = Backbone.Collection.extend({
  update: function(options) {
  console.log('Fetching Data', items.url);
  // audio on station change only
    this.fetch({
      success: function(response) {
        const results = response.toJSON(),
          numRows = options.numRows,
          maxResults = options.maxResults || options.numRows,
          numResults =
            results.length <= maxResults ? results.length : maxResults,
          numPages = Math.ceil(numResults / numRows),
          pageInterval = options.pageInterval || 30000;

        let i = 0,
          page = 0;

        // Load initial results
        sf.display.loadSequentially(
          results.slice(i, i + numRows),
          options.container
        );
        i += numRows;
        page++;
        // This recursive function loops through the results by page
        // After it's finished the last page it updates the items
        // and renders a new page.
        function paginate() {
          setTimeout(() => {
            sf.display.loadSequentially(
              results.slice(i, i + numRows),
              options.container
            );
            i += numRows;
            page++;
            if (page < numPages) {
              paginate(i);
            } else {
              setTimeout(() => {
                items.update(options);
              }, pageInterval);
            }
          }, pageInterval);
        }

        // Paginate if necessary
        if (page < numPages) {
          paginate();
        } else {
          // sequence finished for this update cycle
          setTimeout(() => {
            items.update(options);
          }, pageInterval);
        }
      }
    });
  },
  parse: function(json) {
    return sf.plugins[sf.options.plugin].formatData(json); // normalize this data
  }
});

(sf.items = {
  // Get the data for a board and load it
  init: options => {
    // create the Collection
    items = new sf.Items(); // NOTE GLOBAL!
    items.url = sf.plugins[options.plugin].url(options);

    // check if we're using jsonp
    // TODO: do we still need this? It's 2019!
    if (sf.plugins[options.plugin].dataType === 'jsonp') {
      items.sync = (method, model, options) => {
        options.timeout = 10000;
        options.dataType = 'jsonp';
        return Backbone.sync(method, model, options);
      };
    }

    // pick up any sorting options
    if (options.order && options.sort) {
      items.comparator = item => {
        if (options.order === 'desc') {
          return -item.get(options.sort);
        } else {
          return item.get(options.sort);
        }
      };
    }
  },

  // Get the initial data and load the chart
  load: options => {
    items.update(options);
  }
}),
  /* ********************************************************************* */
  /* DISPLAY METHODS                                                       */

  (sf.display = {
    // DRUM ARRAYS
    // These contain the character sets for each drum. Each position represents
    // a character and when prepended by "c" gives the class name which will
    // be applied to display that character.
    FullDrum: function() {
      return [
        ' ',
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
        'G',
        'H',
        'I',
        'J',
        'K',
        'L',
        'M',
        'N',
        'O',
        'P',
        'Q',
        'R',
        'S',
        'T',
        'U',
        'V',
        'W',
        'X',
        'Y',
        'Z',
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '.',
        ',',
        '?',
        '!',
        '/',
        "'",
        '+',
        '-',
        ':',
        '@',
        '#',
        '↑',
        '↓'
      ];
    },
    CharDrum: function() {
      return [
        ' ',
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
        'G',
        'H',
        'I',
        'J',
        'K',
        'L',
        'M',
        'N',
        'O',
        'P',
        'Q',
        'R',
        'S',
        'T',
        'U',
        'V',
        'W',
        'X',
        'Y',
        'Z',
        '.',
        ','
      ];
    },
    NumDrum: function() {
      return [' ', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', ','];
    },
    ImageDrum: function() {
      return []; // Intentionally empty here. Override in plugins/<plugin_name>/custom.js
    },

    initRow: row => {
      // Expects a jQuery DOM object for 'row'.
      // For each character, grab a new drum array and
      // attach that array to the element's .data() object
      row.find('span').each((index, span) => {
        switch ($(span).closest('div')[0].className) {
          case 'number':
            $(span).data('order', new sf.display.NumDrum()); // Numbers only
            break;
          case 'character':
            $(span).data('order', new sf.display.CharDrum()); // Characters only
            break;
          case 'image':
            $(span).data('order', new sf.display.ImageDrum()); // Images
            break;
          default:
            $(span).data('order', new sf.display.FullDrum()); // The full set
        }
        // Finally, set each character to a space.
        sf.display.change($(span), ' ');
      });
    },

    loadSequentially: (input, container) => {
      const rows = container.find('.row'),
        stagger = sf.options.stagger ? sf.options.stagger : 1000;
      let i = 0;
      function loop() {
        setTimeout(function() {
          if (input[i]) {
            console.log(`Row ${i + 1}:`, input[i]);
            sf.display.loadRow(input[i], $(rows[i]));
          } else {
            console.log(`Row ${i + 1}: Empty`);
            sf.board.clearRow(rows[i]);
          }
          i++;
          if (i < rows.length) {
            loop(i);
          } else {
            // sequence finished; notify page so it can refit the board
            try { $(window).trigger('sf:boardRendered'); } catch (e) {}
          }
        }, stagger);
      }
      loop();
    },

    /**
     * Load the data for a row
     * @param {object} data The JSON for this row
     * @param {object} row A JQuery DOM object representing a row
     */
    loadRow: (data, row) => {
      // Find all the available groups in this row
      const groups = row.find('.group');
      groups.each(group => {
        // Get the data class name for this group
        // This *should* always be the second class.
        // If there's no data for this group use an empty
        // string so we replace what was there before.
        const c = $(groups[group])
          .attr('class')
          .split(/\s+/)[1];
        const d = data[c] ? data[c] : '';
        // Load this group for display
        sf.display.loadGroup(d.toString(), $(groups[group]));
        // Put that value into the group's data store
        $(groups[group]).data('contents', d);
      });
    },

    /**
     * Load a string into a group
     * @param {string} input The string to display for this group of elements
     * @param {object} target A JQuery DOM Object representing a group of elements
     */
    loadGroup: (input, target) => {
      const elements = target.find('span').closest('div'), // may have separators, so check for spans
        strLen = elements.length;
      // ###################################
      // STATUS INDICATORS
      // Add the class "on" to the correct element
      if (target.hasClass('status')) {
        target.find('div').removeClass('on');
        target.find('.s' + input).addClass('on');

        // ###################################
        // IMAGES
        // Only one display element--no need to iterate
      } else if (target.find('.image').length > 0) {
        sf.display.change(target.find('span'), input, false);

        // ###################################
        // NORMAL CHARACTERS
        // otherwise, this group is composed of split-flap character or number elements
      } else {
        input = input.toUpperCase();
        let characters = input.split('');
        // get individual characters and pad the array
        // with spaces (to clear any existing characters)
        for (let i = 0; i < strLen; i++) {
          if (typeof characters[i] === 'undefined') {
            characters[i] = ' ';
          }
        }
        // trim the array to the number of display elements
        characters = characters.slice(0, strLen);
        // assign them to the display elements
        for (let i = 0; i < characters.length; i++) {
          // TODO: is there a more efficient way to do this?
          sf.display.change($(elements[i]).find('span'), characters[i], true);
        }
      }
    },

    /**
     * Change a container from one character or image to another
     * @param {object} container A JQuery DOM Object
     * @param {string} c What to display
     * @param {boolean} isChar True if this is supposed to be a character (not an image);
     */
    change: (container, c, isChar) => {
      // get the curent order of the display element's drum
      let values = container.data('order');
      // how many times do we need to increment the drum?
      let index = values.indexOf(c);
      // set it to blank if character is missing from drum
      if (index === -1) {
        index = values.indexOf(' ');
      }
      // increment the drum
      for (let i = 0; i < index; i++) {
        sf.display.show(container, values[i + 1], isChar);
      }
      // rotate the dom element's stored array to the new order for next time
      container.data('order', values.rotate(index));
    },

    /**
     * This function displays a character in a <span> element
     * @param {object} container A JQuery DOM Object
     * @param {string} i The character to show
     * @param {boolean} isChar True if this is supposed to be a character (not an image);
     */
    show: (container, i, isChar) => {
      let c = isChar ? 'c' + i : i; // character class names are preceded by "c"
      // punctuation has special class names
      // TODO: can we be more efficient here? This method gets called a lot!
      switch (i) {
        case ' ':
          c = 'csp';
          break;
        case '.':
          c = 'cper';
          break;
        case ',':
          c = 'ccom';
          break;
        case '?':
          c = 'cque';
          break;
        case '!':
          c = 'cexc';
          break;
        case '/':
          c = 'csla';
          break;
        case "'":
          c = 'capo';
          break;
        case '+':
          c = 'cplu';
          break;
        case '-':
          c = 'cmin';
          break;
        case ':':
          c = 'ccol';
          break;
        case '@':
          c = 'cat';
          break;
        case '#':
          c = 'chsh';
          break;
        case '↑':
          c = 'cup';
          break;
        case '↓':
          c = 'cdn';
          break;
        case '%':
          c = 'cpct';
          break;
      }
      // (Audio: handled via pulse on update/reset)

      container
        .fadeOut(50, () => {
          container.removeClass().addClass(c);
        })
        .fadeIn(50);
    }
  });
/* END DISPLAY METHODS                                                   */
/* ********************************************************************* */
