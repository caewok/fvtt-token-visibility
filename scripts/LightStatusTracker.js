/* globals
canvas,
CONFIG,
CONST,
foundry,
game,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TRACKER_IDS, FALLBACK_ICON } from "./const.js";
import { TokenUpdateTracker, DocumentUpdateTracker } from "./LOS/UpdateTracker.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { AsyncQueue } from "./LOS/AsyncQueue.js";

/*
Class that can add and remove lighting statuses to tokens based on TokenLightMeter.
Sets up and removes hooks based when created or destroyed.
*/

export class LightStatusTracker {

  static AMBIENT_LIGHT_ATTRIBUTES = [
    "radius",
    "x",
    "y",
    "elevation",
    "rotation",
  ];

  static #queue = new AsyncQueue();

  /** @type {TokenUpdateTracker} */
  tokenTracker = new TokenUpdateTracker(TokenUpdateTracker.LOS_ATTRIBUTES, TokenUpdateTracker.LOS_FLAGS);

  /** @type {DocumentUpdateTracker} */
  lightTracker = new DocumentUpdateTracker("AmbientLight", this.constructor.AMBIENT_LIGHT_ATTRIBUTES);

  hooks = {
    lightMonitor: null,
    iconMonitor: null,
    iconTokenControl: null,
  };

  /**
   * Start monitoring sight refresh and update token dim/no light AEs accordingly.
   * Applies an AE when the token is in dim or dark light.
   */
  startLightMonitor() {
    this.stopLightMonitor();
    this.hooks.lightMonitor = Hooks.on("sightRefresh", this.constructor.lightMonitor.bind(this));
  }

  /**
   * Stop monitoring sight refresh.
   */
  stopLightMonitor() {
    if ( !this.hooks.lightMonitor ) return;
    Hooks.off("sightRefresh", this.hooks.lightMonitor);
    this.hooks.lightMonitor = null;
  }

  static lightMonitor() {
    // If any light was updated, clear all token statuses.
    const lightingUpdated = this.lightTracker.logUpdate();
    for ( const token of canvas.tokens.placeables ) {
      const tokenUpdated = this.tokenTracker.logUpdate(token);
      if ( !(lightingUpdated || tokenUpdated) ) continue;

      // Update the token light AE.
      const lm = token[MODULE_ID][TRACKER_IDS.LIGHT_METER];
      lm.updateLights();
      this.constructor.updateActorLightStatus(token.actor, lm.lightingType);
    }
  }

  static updateActorLightStatus(actor, lightingType) {
    const TYPES = CONST.LIGHTING_LEVELS;
    switch ( lightingType ) {
      case TYPES.BRIGHT:
        console.log(`${MODULE_ID}|${actor.name} is in bright light.`)
        this.#queue.enqueue(async () => this.removeStatusFromActor(actor, "dimLight"));
        this.#queue.enqueue(async () => this.removeStatusFromActor(actor, "noLight"));
        break;
      case TYPES.DIM:
        console.log(`${MODULE_ID}|${actor.name} is in dim light.`)
        this.#queue.enqueue(async () => this.removeStatusFromActor(actor, "noLight"));
        this.#queue.enqueue(async () => this.addStatusToActor(actor, "dimLight"));
        break;
      default:
        console.log(`${MODULE_ID}|${actor.name} is in no light.`)
        this.#queue.enqueue(async () => this.removeStatusFromActor(actor, "dimLight"));
        this.#queue.enqueue(async () => this.addStatusToActor(actor, "noLight"));
    }
  }

  /**
   * Start monitoring sight refresh and user controlled token(s). Place icons on
   * tokens that are in dim or no light w/r/t the controlled token(s).
   */
  startLocalIconMonitor() {
    this.stopLocalIconMonitor();
    this.hooks.iconMonitor = Hooks.on("sightRefresh", this.constructor.iconMonitor.bind(this));
    this.hooks.iconTokenControl = Hooks.on("controlToken", this.constructor.tokenIconControlMonitor.bind(this));
  }

  stopLocalIconMonitor() {
    if ( !this.hooks.iconMonitor ) return;
    Hooks.off("sightRefresh", this.hooks.iconMonitor);
    this.hooks.iconMonitor = null;

    Hooks.off("controlToken", this.hooks.iconTokenControl);
    this.hooks.iconTokenControl = null;
  }

  static tokenIconMonitor() {
    const viewingToken = canvas.tokens.controlled.at(-1);
    if ( !viewingToken ) return;

    const lightingUpdated = this.lightTracker.logUpdate();
    const viewerUpdated = this.tokenTracker.logUpdate(viewingToken);
    const ctr = Point3d.fromTokenCenter(viewingToken);

    for ( const token of canvas.tokens.placeables ) {
      const tokenUpdated = this.tokenTracker.logUpdate(token);
      if ( !(lightingUpdated || viewerUpdated || tokenUpdated) ) continue;

      // Update the token light icon.
      const lm = token[MODULE_ID][TRACKER_IDS.LIGHT_METER];
      lm.updateLights();
      this.updateTokenLightingIcons(token, ctr);
    }
    ctr.release();
  }

  static tokenIconControlMonitor(token, controlled) {
    canvas.tokens.placeables.forEach(token => this.clearIcons(token));
    // TODO: Need to check for lighting or token updates here?
    this.removeIcon(token, "noLight");
    this.removeIcon(token, "dimLight");

    const viewingToken = controlled ? token : canvas.tokens.controlled.at(-1);
    if ( viewingToken ) {
      // For now, change all based on newly controlled viewpoint.
      // TODO: Combined view?
      const ctr = Point3d.fromTokenCenter(viewingToken);
      for ( const other of canvas.tokens.placeables ) {
        if ( other === viewingToken ) continue;
        this.updateTokenLightingIcons(token, ctr);
      }
      ctr.release();

    } else canvas.tokens.placeables.forEach(token => this.clearIcons(token));

    canvas.tokens.placeables.forEach(token => this.constructor.drawIcons(token));
  }

  updateTokenLightingIcons(token, viewpoint) {
    const TYPES = CONST.LIGHTING_LEVELS;
    const lm = token[MODULE_ID][TRACKER_IDS.LIGHT_METER];
    switch ( lm.calculateLightFromViewpoint(viewpoint) ) {
      case TYPES.BRIGHT:
        this.removeIcon(token, "dimLight");
        this.removeIcon(token, "noLight");
        break;
      case TYPES.DIM:
        this.addIcon(token, "dimLight");
        this.removeIcon(token, "noLight");
        break;
      default:
        this.removeIcon(token, "dimLight");
        this.addIcon(token, "noLight");
    }
  }

  /**
   * Add an active effect status to an actor.
   * @param {Actor} actor         Add the status to this actor
   * @param {string} statusId     Id for a status in CONFIG.statusEffects
   * @param {boolean} [duplicate=true]    If true, add regardless of whether the actor already
   *   has the status.
   * @returns {ActiveEffect|false}
   */
  static async addStatusToActor(actor, statusId, duplicate = false) {
    if ( !duplicate && actor.statuses.has(statusId) ) return false;
    const statusEffect = CONFIG.statusEffects.find(elem => elem.id === statusId);
    if ( !statusEffect ) return false;
    const { id, label, icon, hud, ...effectData } = statusEffect;
    effectData.name = game.i18n.localize(label ?? effectData.name);
    effectData.statuses = Array.from(new Set([id, ...effectData.statuses ?? []]))
    console.log(`${MODULE_ID}|Adding ${statusId} to ${actor.name}`);
    try {
      console.log(`${MODULE_ID}|Trying to add ${statusId} to ${actor.name}`);
      await actor.createEmbeddedDocuments("ActiveEffect", [effectData], { keepId: true }); // See dnd5e _onToggleCondition
    } catch(err) {
      console.log(`${MODULE_ID}|Error when trying to add ${statusId} to ${actor.name}`);
      console.debug(err);
    }
    console.log(`${MODULE_ID}|Finished adding ${statusId} to ${actor.name}`);
  }

  /**
   * Remove an active effect status from an actor.
   * @param {Actor} actor         Add the status to this actor
   * @param {string} statusId     Id for a status in CONFIG.statusEffects
   *   has the status.
   * @returns {ActiveEffect result |false}
   */
  static async removeStatusFromActor(actor, statusId) {
    if ( !actor.statuses.has(statusId) ) return false;
    const statusEffect = CONFIG.statusEffects.find(elem => elem.id === statusId);
    console.log(`${MODULE_ID}|Removing ${statusId} from ${actor.name}`);
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", [statusEffect._id]);
    } catch(err) {
      console.debug(err);
    }
    console.log(`${MODULE_ID}|Finished removing ${statusId} from ${actor.name}`);
  }

  static async loadLightIcons() {
    const promises = [];
    for ( const statusId of ["dimLight", "noLight"] ) {
      const statusEffect = CONFIG.statusEffects.find(elem => elem.id === statusId);
      promises.push(this.loadIcon(statusEffect.img));
    }
    return Promise.allSettled(promises);
  }

  /** @type {WeakMap<Token, Set<statusEffect>>} */
  #tokenIconMap = new WeakMap();

  /** @type {Map<string, Texture>} */
  static #iconTextures = new Map();

  /** @type {WeakSet<PIXI.Sprite>} */
  static #icons = new WeakSet();

  /**
   * Retrieve the current statuses for a token.
   * @param {Token} token
   * @param {string} statusId
   * @returns {boolean} True if the status was on the token
   */
  iconsForToken(token) {
    if ( !this.#tokenIconMap.has(token) ) this.#tokenIconMap.set(token, new Set());
    return this.#tokenIconMap.get(token);
  }

  /**
   * Add a status icon from a token.
   * @param {Token} token
   * @param {string} statusId
   * @returns {boolean} True if the status was added (valid and not already present).
   */
  addIcon(token, statusId, clearOthers = false) {
    if ( clearOthers ) this.clearIcons(token);

    const statusEffect = CONFIG.statusEffects.find(elem => elem.id === statusId);
    if ( !statusEffect ) return false;
    const statuses = this.iconsForToken(token);
    if ( statuses.has(statusEffect) ) return false;
    this.iconsForToken(token).add(statusEffect);
    return true;
  }

  /**
   * Remove a status icon from a token.
   * @param {Token} token
   * @param {string} statusId
   * @returns {boolean} True if the status was on the token
   */
  removeIcon(token, statusId) {
    const statusEffect = CONFIG.statusEffects.find(elem => elem.id === statusId);
    return this.iconsForToken(token).delete(statusEffect);
  }

  /**
   * Remove all status icons from a token.
   * @param {Token} token
   * @param {string} statusId
   * @returns {boolean} True if the token had statuses to clear.
   */
  clearIcons(token) {
    const statuses = this.iconsForToken(token);
    if ( !statuses.size ) return false;
    this.iconsForToken(token).clear();
    return true;
  }

  /**
   * Load an icon texture.
   * @param {string} srcs     Texture URL to load
   */
  static async loadIcon(src) {
    if ( this.#iconTextures.has(src) && !this.#iconTextures.get(src).destroyed ) return;
    const tex = await foundry.canvas.loadTexture(src, { fallback: FALLBACK_ICON });
    this.#iconTextures.set(src, tex);
  }

  /**
   * Draw a token's icons on the token.
   * @param {Token} token
   *
   */
  drawIcons(token) {
    // Temporarily disable effects rendering.
    token.effects.renderable = false;

    // Remove the old icons from the token.
    this.constructor._removeIcons(token);

    // Draw each icon on the token.
    this.iconsForToken(token).forEach(icon => this.constructor.drawIcon(token, icon));

    // Refresh the token graphics.
    this.constructor.refreshIcons(token);
    token.effects.renderable = true;
  }

  static _removeIcons(token) {
    const numEffects = token.effects.children.length;
    const removeIndices = [];
    for ( let i = 0; i < numEffects; i += 1 ) {
      const effect = token.effects.children[i];
      if ( !this.#icons.has(effect) ) continue;
      removeIndices.push(i);
      this.#icons.delete(effect);
    }

    // Reverse so the index is not affected by the removal.
    removeIndices.reverse().forEach(i => token.effects.removeChildAt(i)?.destroy());
  }

  /**
   * Draw a single icon on the token.
   * @param {Token} token
   * @param {PIXI.Texture} iconTexture
   * @param {number|null} tint
   * @returns {Promise<PIXI.Sprite|undefined>}
   */
  static drawIcon(token, statusEffect) {
    const tex = this.#iconTextures.get(statusEffect.img);
    const icon = new PIXI.Sprite(tex);
    const tint = statusEffect.tint;
    if ( tint ) icon.tint = Number(tint);
    token.effects.addChild(icon);
    this.#icons.add(icon);
    return icon;
  }

  /**
   * Refresh the display of icons, adjusting their position for token width and height.
   */
  static refreshIcons(token) {
    // See Token#_refreshEffects.
    let i = 0;
    const iconsToRefresh = [];
    for ( const effect of token.effects.children ) {
      if ( effect === token.effects.bg ) continue;
      if ( effect === token.effects.overlay ) continue;
      if ( this.#icons.has(effect) ) iconsToRefresh.push(effect);
      else i += 1; // Determine how many non-icon effects are already drawn.
    }

    // Reorder on grid like with _refreshEffects.
    const size = Math.round(canvas.dimensions.size / 10) * 2;
    const rows = Math.floor(token.document.height * 5);
    for ( const icon of iconsToRefresh ) {
      icon.width = icon.height = size;
      icon.x = Math.floor(i / rows) * size;
      icon.y = (i % rows) * size;
      token.effects.bg.drawRoundedRect(icon.x + 1, icon.y + 1, size - 2, size - 2, 2);
      i += 1;
    }
  }

  destroy() {
    this.#icons.clear();
    this.#iconTextures.forEach(tex => tex.destroy());
    this.#iconTextures.clear();
  }
}

/* Testing
api = game.modules.get("tokenvisibility").api
ls = new api.LightStatusTracker
ls.startLightMonitor()

*/
