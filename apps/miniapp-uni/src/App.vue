<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

onLaunch(() => {
  console.info('[PinBean] app launched')
})
</script>

<style>
page {
  min-height: 100%;
  color: #2f2925;
  background: #f7f2ea;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
}

button::after {
  border: 0;
}
</style>
