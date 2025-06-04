import { Plugin, Notice } from 'obsidian';

export default class FrakiryPlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: 'frakiry-hello',
      name: 'Say hello',
      callback: () => {
        new Notice('Hello from Frakiry Plugin!');
      }
    });
  }

  onunload() {
    console.log('Unloading Frakiry Plugin');
  }
}
