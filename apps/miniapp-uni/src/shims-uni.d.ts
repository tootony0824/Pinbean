/// <reference types="@dcloudio/types" />

import 'vue'

declare module '@vue/runtime-core' {
  type UniHooks = App.AppInstance & Page.PageInstance
  interface ComponentCustomOptions extends UniHooks {}
}
