/* globals
Application,
foundry,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Base folder
import { MODULE_ID } from "../const.js";

export const OPEN_POPOUTS = new Set();

export class Area3dPopout extends Application {

  #savedTop = null;

  #savedLeft = null;

  /** @type {PIXI.Application} */
  pixiApp;

  get canvas() { return document.getElementById(`${this.id}_canvas`); }

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    const options = super.defaultOptions;

    // Default positioning
    // If width calc is necessary:
    // let h = window.innerHeight * 0.9,
    // w = Math.min(window.innerWidth * 0.9, 1200);
    // options.top = area3dPopoutData.savedTop;
    // options.left = area3dPopoutData.savedLeft;
    // Other possible options:
    // options.top = (window.innertop - this.h) / 2;
    // options.left = (window.innerleft - this.w) / 2;
    options.template = `modules/${MODULE_ID}/scripts/LOS/templates/area3d_popout.html`;
    options.popOut = true;
    options.minimizable = true;
    options.title ??= `${MODULE_ID} Debug`;
    return options;
  }

  getData(_options = {}) {
    return { id: `${this.id}_canvas` };
  }

  /* -------------------------------------------- */

  /** @override */
  async _render(force=false, options={}) {
    await super._render(force, options);
    const { width, height } = this.options;

    const pixiApp = this.pixiApp = new PIXI.Application({
      width,
      height: height - 75, // Leave space at bottom for text (percent visibility).
      view: this.canvas,
      backgroundColor: 0xD3D3D3
    });

    // Center of window should be 0,0
    pixiApp.stage.position.x = width * 0.5;  // 200 for width 400
    pixiApp.stage.position.y = (height - 75) * 0.5;  // 200 for height 400

    // Scale to give a bit more room in the popout
    pixiApp.stage.scale.x = 1;
    pixiApp.stage.scale.y = 1;

    OPEN_POPOUTS.add(this);

    // Add pixi app
    // this.pixiApp = new PIXI.Application({
    // width: 400, height: 400, view: document.getElementById("area3dcanvas"), backgroundColor: 0xD3D3D3 });
    // this.pixiApp = new PIXI.Application({
    // width: 400, height: 400, view: document.getElementById("area3dcanvas"), backgroundColor: 0xD3D3D3 });

    return this;
  }


  //   /* -------------------------------------------- */
  /** @override */
  close() {
    this.#savedTop = this.position.top;
    this.#savedLeft = this.position.left;
    if ( !this.closing && this.pixiApp & this.pixiApp.renderer ) this.pixiApp.destroy();
    super.close();
    OPEN_POPOUTS.delete(this);
  }
}

export class Area3dPopoutV2 extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-app-{id}`,
    // classes: `${MODULE_ID}-popout`,
    window: {
      title: `${MODULE_ID} Debug`,
      minimizable: true,
    },
    position: {
      width: 400,
      height: 500,
    },
  };

  static PARTS = { popout: { template: `modules/${MODULE_ID}/scripts/LOS/templates/area3d_popout.html` }};

  #savedTop = null;

  #savedLeft = null;

  static TEMPLATE = `modules/${MODULE_ID}/scripts/LOS/templates/area3d_popout.html`;

  pixiApp;

  get canvas() {
    const appElem = document.getElementById(this.id);
    const canvasElem = appElem.getElementsByTagName("canvas")[0];
    if ( !canvasElem ) return console.error(`${MODULE_ID}|PIXI App canvas not found.`);
    return canvasElem;
  }

  /* -------------------------------------------- */
  close() {
    this.#savedTop = this.position.top;
    this.#savedLeft = this.position.left;
    super.close();
  }

  async _onFirstRender(context, options) {
    const out = await super._onFirstRender(context, options);

    const width = this.options.position.width;
    const height = this.options.position.height - 100; // Leave space at bottom for text (percent visibility).
    const pixiApp = this.pixiApp = new PIXI.Application({
      width,
      height,
      view: this.canvas,
      backgroundColor: 0xD3D3D3
    });

    // Center of window should be 0,0
    pixiApp.stage.position.x = width * 0.5;  // 200 for width 400
    pixiApp.stage.position.y = height * 0.5;  // 200 for height 400

    // Scale to give a bit more room in the popout
    pixiApp.stage.scale.x = 1;
    pixiApp.stage.scale.y = 1;

    OPEN_POPOUTS.add(this);

    return out;


    // let html = await renderTemplate(this.constructor.TEMPLATE, {});
    // return html;
    // const canvas = document.createElement("canvas");
  }

  _onClose(_options) {
    this.#savedTop = this.position.top;
    this.#savedLeft = this.position.left;
    if ( !this.closing && this.pixiApp & this.pixiApp.renderer ) this.pixiApp.destroy();
    OPEN_POPOUTS.delete(this);
  }

//   _replaceHTML(result, content, _options) {
//     content.replaceChildren(result);
//   }
}

export class Area3dPopoutCanvas extends Application {

  #savedTop = null;

  #savedLeft = null;

  static async supportsWebGPU() {
    if ( !navigator.gpu ) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return Boolean(adapter);
  }

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    const options = super.defaultOptions;

    // Default positioning
    // If width calc is necessary:
    // let h = window.innerHeight * 0.9,
    // w = Math.min(window.innerWidth * 0.9, 1200);
    // options.top = area3dPopoutData.savedTop;
    // options.left = area3dPopoutData.savedLeft;
    // Other possible options:
    // options.top = (window.innertop - this.h) / 2;
    // options.left = (window.innerleft - this.w) / 2;
    options.template = `modules/${MODULE_ID}/scripts/LOS/templates/area3d_popout.html`;
    options.popOut = true;
    options.minimizable = true;
    options.title ??= `${MODULE_ID} Debug`;



    return options;
  }

  get canvas() { return document.getElementById(`${this.id}_canvas`); }

  getData(_options = {}) {
    return { id: `${this.id}_canvas` };
  }

  /* -------------------------------------------- */

  /** @override */
  async _render(force=false, options={}) {
    await super._render(force, options);
    this.contextType = options.contextType ?? ((await this.constructor.supportsWebGPU()) ? "webgpu" : "webgl");
    this.context = this.canvas.getContext(this.contextType, options.contextConfiguration);
    OPEN_POPOUTS.add(this);
    return this;
  }

  //   /* -------------------------------------------- */
  /** @override */
  close() {
    this.#savedTop = this.position.top;
    this.#savedLeft = this.position.left;
    super.close();
    OPEN_POPOUTS.delete(this);
  }
}

export class Area3dPopoutCanvasV2 extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-app-{id}`,
    // classes: `${MODULE_ID}-popout`,
    window: {
      title: `${MODULE_ID} Debug`,
      minimizable: true,
    },
    position: {
      width: 400,
      height: 500,
    },
    contextType: "webgl",
    contextConfiguration: {
      powerPreference: "high-performance",
      antialias: false,
      depth: true,
      stencil: true,
      alpha: true,  // Equivalent to alpha: "premultiplied" in WebGPU.
      premultiplied: true,
    },
  };

  static async supportsWebGPU() {
    if ( !navigator.gpu ) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return Boolean(adapter);
  }

  get canvas() {
    const appElem = document.getElementById(this.id);
    const canvasElem = appElem.getElementsByTagName("canvas")[0];
    if ( !canvasElem ) return console.error(`${MODULE_ID}|PIXI App canvas not found.`);
    return canvasElem;
  }

  static PARTS = { popout: { template: `modules/${MODULE_ID}/scripts/LOS/templates/area3d_popout.html` }};

  #savedTop = null;

  #savedLeft = null;

  /* -------------------------------------------- */
  close() {
    this.#savedTop = this.position.top;
    this.#savedLeft = this.position.left;
    super.close();
  }

  async _onFirstRender(context, options) {
    const out = await super._onFirstRender(context, options);

    this.contextType = options.contextType ?? ((await this.constructor.supportsWebGPU()) ? "webgpu" : "webgl");
    this.context = this.canvas.getContext(this.contextType, options.contextConfiguration);
    OPEN_POPOUTS.add(this);
    return out;
  }

  _onClose(_options) {
    this.#savedTop = this.position.top;
    this.#savedLeft = this.position.left;
    OPEN_POPOUTS.delete(this);
  }

}

