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
      view: document.getElementById(`${this.id}_canvas`),
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
    const appElem = document.getElementById(this.id);
    const canvasElem = appElem.getElementsByTagName("canvas")[0];
    if ( !canvasElem ) return console.error(`${MODULE_ID}|PIXI App canvas not found.`);
    const pixiApp = this.pixiApp = new PIXI.Application({
      width,
      height,
      view: canvasElem,
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

  _onClose(options) {
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

  /** @type {PIXI.Application} */
  pixiApp;

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
    if ( !this.closing && this.pixiApp ) this.pixiApp.destroy();
    super.close();
    OPEN_POPOUTS.delete(this);
  }
}


// Hooks.on("canvasReady", function() {
//   for ( const [key, obj] of Object.entries(AREA3D_POPOUTS) ) {
//     obj.app = new Area3dPopout({ title: `Area3d Debug: ${key}`, type: key });
//   }
// });

// Hooks.on("renderArea3dPopout", function(app, _html, _data) {
//   const id = `${app.options.id}_canvas`;
//   app.pixiApp = new PIXI.Application({
// width: 400, height: 400, view: document.getElementById(id), backgroundColor: 0xD3D3D3 });
//
//   // Center of window should be 0,0
//   app.pixiApp.stage.position.x = 200;  // 200 for width 400
//   app.pixiApp.stage.position.y = 200;  // 200 for height 400
//
//   // Scale to give a bit more room in the popout
//   app.pixiApp.stage.scale.x = 1;
//   app.pixiApp.stage.scale.y = 1;
// });

/* Testing
api = game.modules.get("tokenvisibility").api
Area3dPopout = api.Area3dPopout
popout = new Area3dPopout()
popout.render(true)

gr  = new PIXI.Graphics();
gr.beginFill(0x6200EE);
gr.lineStyle(3, 0xff0000);
gr.drawCircle(100, 100, 50);
gr.endFill();

popout.pixiApp.stage.addChild(gr)


class Popout extends Application {
  static get defaultOptions() {
    const options = super.defaultOptions;
    options.popOut = true;
    options.id = "popout";
    options.template = `modules/tokenvisibility/templates/area3d_popout.html`;
    return options;
  }
}

app = new Popout()
app.render(true)

pixiApp = new PIXI.Application({width: 400, height: 400, view: document.getElementById("area3dcanvas")})

gr  = new PIXI.Graphics();
gr.beginFill(0x6200EE);
gr.lineStyle(3, 0xff0000);
gr.drawCircle(100, 100, 50);
gr.endFill();
pixiApp.stage.addChild(gr)

*/
