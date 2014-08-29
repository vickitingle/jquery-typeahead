/**
 * jQuery Typeahead
 *
 * @author Tom Bertrand
 * @version 0.1.6 Beta (2014-08-28)
 *
 * @copyright
 * Copyright (C) 2014 RunningCoder.
 *
 * @link
 * http://www.runningcoder.org/jquerytypeahead/
 *
 * @license
 * Licensed under the MIT license.
 */
(function (window, document, $, undefined)
{

    window.Typeahead = {
        source: {}
    };

    /**
     * Fail-safe preventExtensions function for older browsers
     */
    if (typeof Object.preventExtensions !== "function") {
        Object.preventExtensions = function (obj) { return obj; }
    }

    // Not using strict to avoid throwing a window error on bad config extend.
    // window.Debug function is used instead
    //"use strict";

    /**
     * @private
     * Default options
     *
     * @link http://www.runningcoder.org/jquerytypeahead/documentation/
     */
    var _options = {
        input: null,
        minLength: 2,
        maxItem: 8,
        order: null,
        position: "any",
        list: false,
        group: false,
        filter: false,
        backdrop: false,
        jStorage: false,
        ttl: 3600000,
        compression: false,
        containerClass: "typeahead-search-container",
        fieldClass: "typeahead-search-field",
        groupClass: "typeahead-search-group",
        resultClass: "typeahead-search-result",
        backdropClass: "typeahead-search-backdrop",
        source: null,
        callback: {
            onInit: null,
            onMouseEnter: null,
            onMouseLeave: null,
            onClick: null
        },
        debug: false
    };

    /**
     * @private
     * Limit the supported options on matching keys
     */
    var _supported = {
        order: ["asc", "desc"],
        position: ["any", "start"],
        group: [true, false],
        jStorage: [true, false],
        compression: [true, false],
        //source: ["data", "url", "ignore"],
        //callback: ["onInit", "onMouseEnter", "onMouseLeave", "onClick"],
        debug: [true, false]
    }

    /**
     * @private
     * Class selectors to reach class-constructed elements
     */
    var _selector = {
        filter: "typeahead-filter",
        dropdown: "typeahead-dropdown"
    };

    // =================================================================================================================

    /**
     * @constructor
     * Typeahead Class
     *
     * @param {object} node jQuery input object
     * @param {object} options User defined options
     */
    var Typeahead = function (node, options) {

        var query = "",
            isGenerated = false,
            storage = {},
            result = [],
            jsonpCallback = "window.Typeahead.source['" + node.selector + "'].populate",
            counter = 0,
            length = 0;

        /**
         * Extends user-defined "options" into the default Typeahead "_options".
         * Notes:
         *  - preventExtensions prevents from modifying the Typeahead "_options" object structure
         *  - filter through the "_supported" to delete unsupported "options"
         */
        function extendOptions () {

            if (!$.jStorage || !options.jStorage) {
                options.debug && window.Debug.log({
                    'node': node.selector,
                    'function': 'extendOptions()',
                    'arguments': 'options.jStorage',
                    'message': 'WARNING - It is strongly recommended to have $.jStorage available and the option activated to store the results'
                });
            }

            for (var option in options) {
                if (!options.hasOwnProperty(option)) {
                    continue;
                }

                if (option === "source") {

                    if (JSON.stringify(options[option]) === "{}") {
                        options.debug && window.Debug.log({
                            'node': node.selector,
                            'function': 'extendOptions()',
                            'arguments': "{options.source}",
                            'message': 'ERROR - source.list.url or source.list.data is Required'
                        });
                    }
                    for (var list in options[option]) {

                        if (!options[option].hasOwnProperty(list)) {
                            continue;
                        }

                        if (!(options[option][list] instanceof Object) || list === "data") {
                            list = "list";
                            options[option] = {
                                list: options[option]
                            };
                        }

                        if (!options[option][list].url && !options[option][list].data) {
                            _options.debug && window.Debug.log({
                                'node': node.selector,
                                'function': 'extendOptions()',
                                'arguments': "{options.source}",
                                'message': 'ERROR - source.list.url or source.list.data is Required'
                            });
                        }
                    }

                } else if (_supported[option] && $.inArray(options[option], _supported[option]) === -1) {

                    options.debug && window.Debug.log({
                        'node': node.selector,
                        'function': 'extendOptions()',
                        'arguments': "{" + option + ":" + JSON.stringify(options[option]) + "}",
                        'message': 'WARNING - Unsupported option: ' + option
                    });

                    delete options[option];

                }
            }

            options = $.extend(
                true,
                Object.preventExtensions(
                    $.extend(
                        true,
                        {},
                        _options
                    )
                ),
                options
            );

        }

        /**
         * Attach events to the search input to trigger the Typeahead Search
         */
        function delegateTypeahead () {

            _executeCallback(options.callback.onInit, [node]);

            options.debug && window.Debug.log({
                'node': node.selector,
                'function': 'delegateTypeahead()',
                'arguments': JSON.stringify(options),
                'message': 'OK - Typeahead activated on ' + node.selector
            });

            // Namespace events to avoid conflicts
            var namespace = ".typeahead",
                event = [
                    'filter' + namespace,
                    'focus' + namespace,
                    //'keyup' + namespace,
                    //'keypress' + namespace,
                    'keydown' + namespace
                ];

            $('html').on("click" + namespace, function() {
                reset();
            });

            $(node).parents('.' + options.containerClass).on("click" + namespace, function(e) {
                e.stopPropagation();
            });

            $(node).on(event.join(' '), function (e) {

                if (e.keyCode && $.inArray(e.keyCode, [38,39,40]) !== -1) {
                    move(e);
                    return;
                }

                if (e.type === "focus" && !isGenerated) {
                    generateList();
                }

                var input = this,
                    filter = options.filter &&
                        $(node).parents('.' + options.containerClass).find('.' + _selector.filter).text();

                if (filter && filter.toLowerCase() === options.filter.toLowerCase()) {
                    filter = null;
                }

                setTimeout( function () {

                    if (!isGenerated || $(input).val() === query) {
                        return false;
                    }

                    query = $(input).val().toLowerCase().trim();

                    reset();

                    if (query.length >= options.minLength && query !== "") {
                        search(filter);
                        buildHtml();
                    }

                }, 0, e, input);

            });

        }

        /**
         * Search the json lists to match the search query and build the HTML and bind
         * the callbacks on the result(s) if they are set inside the configuration options
         *
         * @param {string} [filter] If options.filter is enables and a filter is selected
         * only search through a selected data set
         */
        function search (filter) {

            if (query === "") {
                return false;
            }

            for (var list in storage) {

                if (filter && list !== filter) {
                    continue;
                }

                for (var i in storage[list]) {

                    if (result.length >= options.maxItem) {
                        break;
                    }

                    if (storage[list][i].display &&
                        storage[list][i].display.toLowerCase().indexOf(query) !== -1 && (
                            options.position === "any" ||
                            storage[list][i].display.toLowerCase().indexOf(query) === 0
                        ))
                    {
                        if (options.source[list].ignore && $.inArray(storage[list][i].display, options.source[list].ignore) !== -1) {
                            continue;
                        }

                        storage[list][i].list = list;
                        result.push(storage[list][i]);
                    }
                }
            }

            if (options.order) {
                result.sort(
                    sort_by(
                        'display',
                        (options.group) ? !(options.order === "asc") : !!(options.order === "asc"),
                        function(a){return a.toUpperCase()}
                    )
                );
            }

        }

        /**
         * Builds the search result list html and delegate the callbacks
         */
        function buildHtml () {

            if (result.length !== 0) {

                var match,
                    template = $("<div/>", {
                    "class": options.resultClass,
                    "html": $("<ul/>", {
                        "html": function() {

                            for (var i in result) {
                                (function (result, scope) {

                                    if (options.group && !$(scope).find('li[data-search-group="' + result.list + '"]')[0]) {
                                        $(scope).append(
                                            $("<li/>", {
                                                "class": options.groupClass,
                                                "html":  $("<a/>", {
                                                    "html": result.list
                                                }),
                                                "data-search-group": result.list
                                            })
                                        );
                                    }

                                    match = result.display.match(new RegExp(query,"i"));

                                    var li = $("<li/>", {
                                        "html":  $("<a/>", {
                                            "href": "javascript:;",
                                            "data-list": result.list,
                                            "html": result.display.replace(new RegExp(query,"i"), '<strong>' + match[0] + '</strong>') +
                                                ((options.list) ? "<small>" + result.list + "</small>" : ""),
                                            "click": ({"result": result}, function (e) {

                                                e.preventDefault();

                                                $(node).val(result.display).focus();

                                                query = result.display;

                                                reset();

                                                _executeCallback(options.callback.onClick, [node, this, result])
                                            }),
                                            "mouseenter": function () {

                                                $(this).parents('.' + options.resultClass).find('.active').removeClass('active');

                                                _executeCallback(options.callback.onMouseEnter, [node, this, result]);
                                            },
                                            "mouseleave": function () {
                                                _executeCallback(options.callback.onMouseLeave, [node, this, result]);
                                            }

                                        }),
                                        "mouseenter": function () {

                                            $(this).siblings('li.active').removeClass('active');
                                            $(this).addClass('active');

                                        }
                                    });

                                    if (options.group) {
                                        $(li).insertAfter($(scope).find('li[data-search-group="' + result.list + '"]'));
                                    } else {
                                        $(scope).append(li);
                                    }

                                }(result[i], this));
                            }

                        }
                    })
                });

                $(node).parents('.' + options.containerClass)
                    .addClass('result')
                    .append(template);
            }

            if (!options.backdrop || query === "") {
                return;
            }

            var css = $.extend(
                {
                    "opacity": 0.6,
                    "filter": 'alpha(opacity=60)',
                    "position": 'fixed',
                    "top": 0,
                    "right": 0,
                    "bottom": 0,
                    "left": 0,
                    "z-index": 1040,
                    "background-color": "#000"
                },
                options.backdrop
            );

            $(node).parents('.' + options.containerClass)
                .addClass('backdrop')
                .css({
                    "z-index": css["z-index"] + 1,
                    "position": "relative"
                });


            $("<div/>", {
                    "class": options.backdropClass,
                    "css": css,
                    "click": function () {
                        reset();
                    }
                }
            ).insertAfter($(node).parents('.' + options.containerClass))

        }

        /**
         * Arrow key navigation
         *
         * @param {object} e Triggered keydown Event object
         */
        function move (e) {

            if (result.length === 0) {
                return false;
            }

            var lis = $(node).parents('.' + options.containerClass)
                .find('.' + options.resultClass)
                .find('li:not([data-search-group])'),
                li = lis.siblings('.active');

            li.removeClass('active');

            if (e.keyCode === 40) {

                e.preventDefault();

                if (li[0]) {
                    li.next().addClass('active')
                } else {
                    $(lis[0]).addClass('active')
                }

            } else if (e.keyCode === 38) {

                e.preventDefault();

                if (li[0]) {
                    li.prev().addClass('active')
                } else {
                    $(lis[result.length - 1]).addClass('active')
                }

            } else if (e.keyCode === 39) {
                reset();
                return;
            }

            // Skip "group" selection
            if (options.group) {

                var tmpLi = lis.siblings('.active');
                if (tmpLi.attr('data-search-group')) {

                    tmpLi.removeClass('active');

                    if (e.keyCode === 40) {
                        tmpLi.next().addClass('active')
                    } else if (e.keyCode === 38) {
                        tmpLi.prev().addClass('active')
                    }
                }
            }
            $(node).val(lis.filter('.active').clone().find('small').remove().end().text().toLowerCase() || query)

        }

        /**
         * Clears the search result list
         */
        function reset () {

            result = [];

            var containerClass = $(node).parents('.' + options.containerClass);

            if (options.filter) {
                containerClass
                    .removeClass('filter')
                    .find('.' + _selector.dropdown)
                    .hide();
            }

            containerClass
                .removeClass('result')
                .find('.' + options.resultClass)
                .remove();

            containerClass
                .removeClass('backdrop')
                .removeAttr('style')
                .siblings('.' + options.backdropClass)
                .remove();

        }

        /**
         * Depending on the list format given by the initialization, this method
         * concats (if needed) and build unified json Lists.
         * Supports inline data, same-domain ajax and crossdomain ajax (jsonP)
         */
        function generateList () {

            var source = options.source;

            if (length === 0) {
                for (var k in source) {
                    if (source.hasOwnProperty(k)) {
                        ++length;
                    }
                }
            }

            for (var list in source) {
                if (!source.hasOwnProperty(list)) {
                    continue;
                }

                // Lists are loaded
                if ((storage[list] && storage[list] !== [])) {
                    counter++;
                    continue;
                }

                // Lists from jStorage
                if (options.jStorage && $.jStorage) {
                    storage[list] = $.jStorage.get(node.selector + ":" + list);
                    if (storage[list]) {

                        if (options.compression && typeof LZString === "object") {
                            storage[list] = JSON.parse(LZString.decompress(storage[list]));
                        }

                        counter++;
                        continue;
                    }
                }

                storage[list] = [];

                // Lists from configuration
                if (source[list].data && source[list].data instanceof Array) {

                    for (var i in source[list].data) {
                        if (source[list].data[i] instanceof Object) {
                            break;
                        }

                        source[list].data[i] = {
                            display: source[list].data[i]
                        }
                    }

                    storage[list] = storage[list].concat(source[list].data);

                    if (!source[list].url) {

                        _populateStorage(list);

                        counter++;
                        continue;
                    }
                }

                if (source[list].url) {

                    var url = (source[list].url instanceof Array && source[list].url[0]) || source[list].url,
                        path = (source[list].url instanceof Array && source[list].url[1]) || null;

                    // Cross Domain
                    if (/https?:\/\//.test(url) && url.indexOf(window.location.host) === -1) {

                        if (url.indexOf('{callback}') === -1) {
                            options.debug && window.Debug.log({
                                'node': node.selector,
                                'function': 'generateList()',
                                'arguments': 'url',
                                'message': 'ERROR - Missing {callback} string inside url, " + list + " skipped.'
                            });
                            counter++;
                            continue;
                        }

                        _jsonp.fetch(url.replace("{callback}", encodeURIComponent(jsonpCallback)), function (data) {});

                    } else {
                    // Same Domain

                        $.ajax({
                            async: true,
                            url: url,
                            ajaxList: list,
                            ajaxPath: path
                        }).done( function(data) {

                            _populateSource(data, this.ajaxList, this.ajaxPath);

                            counter++;
                            if (counter === length) {
                                isGenerated = true;
                                console.log('ALL LIST FETCHED (done ajax)')
                            }

                        }).fail( function (response) {

                            counter++;
                            if (counter === length) {
                                isGenerated = true;
                                console.log('ALL LIST FETCHED (fail ajax)')
                            }
                        });

                    }

                }

            }

            if (counter === length) {
                isGenerated = true;
                console.log('ALL LIST FETCHED (regular function)')
            }
        }

        /**
         * Attach events to the dropdown list when options.filter is activated
         */
        function delegateDropdown () {

            if (!options.filter) {
                return false;
            }

            $('<span/>', {
                "class": "list",
                "html": function () {

                    $(this).append(
                        $('<button/>', {
                            "type": "button",
                            "html": "<span class='" + _selector.filter + "'>" + options.filter + "</span> <span class='caret'></span>",
                            "click": function () {
                                $(this).parents('.' + options.containerClass)
                                    .addClass('filter')
                                    .find('.' + _selector.dropdown).show()
                            }
                        })
                    )

                    $(this).append(
                        $('<ul/>', {
                            "class": _selector.dropdown,
                            "html": function () {

                                for (var i in options.source) {
                                    (function (i, scope) {


                                        var li = $("<li/>", {
                                            "html":  $("<a/>", {
                                                "href": "javascript:;",
                                                "html": i,
                                                "click": ({"i": i}, function (e) {
                                                    e.preventDefault();
                                                    _selectFilter(i);
                                                })

                                            })
                                        });
                                        $(scope).append(li);
                                    }(i, this));
                                }

                                $(this).append(
                                    $("<li/>", {
                                        "class": "divider"
                                    })
                                );

                                $(this).append(
                                    $("<li/>", {
                                        "html":  $("<a/>", {
                                            "href": "javascript:;",
                                            "html": options.filter,
                                            "click": function (e) {
                                                e.preventDefault();
                                                _selectFilter();
                                            }
                                        })
                                    })
                                );
                            }
                        })
                    )
                }
            }).insertAfter(
                $(node).parents('.' + options.containerClass).find('.query')
            )

            /**
             * @private
             * Select the filter and rebuild the result list
             *
             * @param {string} [filter]
             */
            function _selectFilter(filter) {

                $(node).parents('.' + options.containerClass)
                    .find('.' + _selector.filter)
                    .text(filter || options.filter);

                $(node).parents('.' + options.containerClass)
                    .find('.' + _selector.dropdown)
                    .hide()

                reset();
                search(filter);
                buildHtml();

                $(node).focus();

            }

        }

        /**
         * @public
         * This method will be called by the jsonP callback to populate the JSON list
         *
         * @param {object} data JSON response from the jsonP call
         */
        function populate (data) {

            if (!data || !data.list) {

                options.debug && window.Debug.log({
                    'node': node.selector,
                    'function': 'populate()',
                    'message': 'ERROR - Empty data or Missing {data.list} parameter"'
                });

                window.Debug.print();

                return false;
            }

            var list = data.list || 'list',
                path = (options.source[list].url instanceof Array) ?
                    options.source[list].url[1] : null;


            _populateSource(data, list, path);

            ++counter;

            if (counter === length) {
                isGenerated = true;
                console.log('ALL LIST FETCHED')
            }

        }

        /**
         * @private
         * Common method to build the JSON lists to be cycled for matched results from data, url or cross domain url.
         *
         * @param {array} data Raw data to be formatted
         * @param {string} list List name
         * @param {string} [path] Optional path if the list is not on the data root
         *
         */
        var _populateSource = function (data, list, path) {

            var _isValid = true;

            if (path) {

                var _exploded = path.split('.'),
                    _splitIndex = 0;

                while (_splitIndex < _exploded.length) {
                    if (typeof data !== 'undefined') {
                        data = data[_exploded[_splitIndex++]];
                    } else {
                        _isValid = false;
                        break;
                    }
                }
            }

            if (_isValid) {

                for (var i in data) {
                    if (data[i] instanceof Object) {
                        break;
                    }
                    data[i] = {
                        display: data[i]
                    }
                }

                storage[list] = storage[list].concat(data);

                _populateStorage(list);
            }

        };

        /**
         * @private
         * Store the data inside jStorage so the urls are not fetched on every pageloads
         *
         * @param {string} list
         */
        var _populateStorage = function (list) {

            if (!options.jStorage || !$.jStorage) {
                return false;
            }

            var data = storage[list];

            if (options.compression && typeof LZString === "object") {
                data = LZString.compress(JSON.stringify(data));
            }

            $.jStorage.set(
                node.selector + ":" + list,
                data,
                {
                    TTL: options.ttl
                }
            );

        };

        /**
         * @private
         * Sort list of object by key
         *
         * @param field
         * @param reverse
         * @param primer
         *
         * @returns {Function}
         */
        var sort_by = function(field, reverse, primer){

            var key = primer ?
                function(x) {return primer(x[field])} :
                function(x) {return x[field]};

            reverse = [-1, 1][+!!reverse];

            return function (a, b) {
                return a = key(a), b = key(b), reverse * ((a > b) - (b > a));
            }
        }

        /**
         * @private
         * Executes an anonymous function or a string reached from the window scope.
         *
         * @example
         * Note: These examples works with every configuration callbacks
         *
         * // An anonymous function inside the "onInit" option
         * onInit: function() { console.log(':D'); };
         *
         * * // myFunction() located on window.coucou scope
         * onInit: 'window.coucou.myFunction'
         *
         * // myFunction(a,b) located on window.coucou scope passing 2 parameters
         * onInit: ['window.coucou.myFunction', [':D', ':)']];
         *
         * // Anonymous function to execute a local function
         * onInit: function () { myFunction(':D'); }
         *
         * @param {string|array} callback The function to be called
         * @param {array} [extraParams] In some cases the function can be called with Extra parameters (onError)
         *
         * @returns {boolean}
         */
        var _executeCallback = function (callback, extraParams) {

            if (!callback) {
                return false;
            }

            var _callback;

            if (typeof callback === "function") {

                _callback = callback;

            } else if (typeof callback === "string" || callback instanceof Array) {

                _callback = window;

                if (typeof callback === "string") {
                    callback = [callback, []];
                }

                var _exploded = callback[0].split('.'),
                    _params = callback[1],
                    _isValid = true,
                    _splitIndex = 0;

                while (_splitIndex < _exploded.length) {

                    if (typeof _callback !== 'undefined') {
                        _callback = _callback[_exploded[_splitIndex++]];
                    } else {
                        _isValid = false;
                        break;
                    }
                }

                if (!_isValid || typeof _callback !== "function") {

                    options.debug && window.Debug.log({
                        'node': node.selector,
                        'function': '_executeCallback()',
                        'arguments': JSON.stringify(callback),
                        'message': 'WARNING - Invalid callback function"'
                    });

                    return false;
                }

            }

            _callback.apply(this, $.merge(_params || [], (extraParams) ? extraParams : []));
            return true;

        };

        /**
         * @private
         * Private function to retrieve data from a cross domain jsonP call
         *
         * @type {{fetch: fetch, evalJSONP: evalJSONP}}
         * @url http://javascriptweblog.wordpress.com/2010/11/29/json-and-jsonp/
         */
        var _jsonp = {
            fetch: function (url, callback) {
                var fn = encodeURIComponent(jsonpCallback);
                window[fn] = this.evalJSONP(callback);
                url = url.replace('=' + jsonpCallback, '=' + fn);

                var scriptTag = document.createElement('SCRIPT');
                scriptTag.src = url;
                document.getElementsByTagName('HEAD')[0].appendChild(scriptTag);
            },
            evalJSONP: function (callback) {

                return function (data) {
                    var validJSON = false;
                    if (typeof data === "string") {
                        try { validJSON = JSON.parse(data); } catch (e) {
                            // invalid JSON
                        }
                    } else {
                        validJSON = JSON.parse(JSON.stringify(data));
                    }
                    if (validJSON) {
                        callback(validJSON);
                    } else {
                        throw ("JSONP call returned invalid or empty JSON");
                    }
                };
            }
        };

        /**
         * @private
         * Constructs Typeahead
         */
        this.__construct = function () {

            extendOptions();
            delegateTypeahead();
            delegateDropdown();

            window.Debug && window.Debug.print();

        }();

        return {

            /**
             * @public
             * Populate data from jsonp call
             */
            populate: populate

        };

    };


    /**
     * @public
     * jQuery public function to implement the Typeahead on the selected node.
     *
     * @param {object} options To configure the Typeahead class.
     *
     * @return {object} Modified DOM element
     */
    $.fn.typeahead = $.typeahead = function (options) {

        return _api.typeahead(this, options);

    };

    // =================================================================================================================

    /**
     * @private
     * API to handles Enabling the Typeahead via jQuery.
     *
     * @example
     * $.typeahead({})
     *
     * @returns {object} Updated DOM object
     */
    var _api = {

        /**
         * API method to enable the typeahead on the specified input.
         *
         * @param {object} node jQuery object(s)
         * @param {object} options To configure the Typeahead class.
         *
         * @returns {*}
         */
        typeahead: function (node, options) {

            if (!options || !options.source) {
                window.Debug.log({
                    'node': node.selector,
                    'function': '$.typeahead()',
                    'arguments': '',
                    'message': 'Missing source option - Typeahead dropped'
                });

                window.Debug.print();
                return;
            }

            if (typeof node === "function") {

                if (!options.input) {
                    window.Debug.log({
                        'node': node.selector,
                        'function': '$.typeahead()',
                        'arguments': '',
                        'message': 'Undefined property "options.input - Typeahead dropped'
                    });

                    window.Debug.print();
                    return;
                }

                node = $(options.input);

                if (!node[0] || node.length > 1) {
                    window.Debug.log({
                        'node': node.selector,
                        'function': '$.typeahead()',
                        'arguments': JSON.stringify(options.input),
                        'message': 'Unable to find jQuery input element OR more than 1 input is found - Typeahead dropped'
                    });

                    window.Debug.print();
                    return;
                }

            } else if (typeof node[0] === 'undefined' || node.length > 1/* || node[0].nodeName.toLowerCase() !== "input"*/) {

                window.Debug.log({
                    'node': node.selector,
                    'function': '$.typeahead()',
                    'arguments': '$("' + node['selector'] + '").typeahead()',
                    'message': 'Unable to find jQuery input element OR more than 1 input is found - Typeahead dropped'
                });

                window.Debug.print();
                return;
            }

            return node.each(function () {
                window.Typeahead.source[node.selector] = new Typeahead(node, options);
            });

        }

    };

    window.Debug = {

        table: {},
        log: function (debugObject) {

            if (!debugObject.message || typeof debugObject.message !== "string") {
                return false;
            }

            this.table[debugObject.message] = $.extend(
                Object.preventExtensions(
                    {
                        'node': '',
                        'function': '',
                        'arguments': ''
                    }
                ), debugObject
            )

        },
        print: function () {

            if ($.isEmptyObject(this.table)) {
                return false;
            }

            if (console.group !== undefined || console.table !== undefined) {

                console.groupCollapsed('--- jQuery Typeahead Debug ---');

                if (console.table) {
                    console.table(this.table);
                } else {
                    $.each(this.table, function (index, data) {
                        console.log(data['Name'] + ': ' + data['Execution Time']+'ms');
                    });
                }

                console.groupEnd();

            } else {
                console.log('Debug is not available on your current browser, try the most recent version of Chrome or Firefox.');
            }

            this.table = {};

        }

    };

}(window, document, window.jQuery));