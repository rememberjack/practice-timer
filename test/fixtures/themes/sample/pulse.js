/* how big the dot is: the last minute of playing, and a little more on a new note */
'use strict';
function pulse(recent, note) { return Math.min(1, 0.2 + 0.8 * recent + 0.2 * note); }
module.exports = { pulse };
