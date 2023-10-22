/* globals
FormApplication
*/
"use strict";

export class SettingsButton extends FormApplication {
  render() {
    this.buttonFn().catch(err => console.error(err));
    return this;
  }

  async buttonFn() {
    console.error("SettingsButton|Button function must be overridden by subclass.");
  }
}
