<script lang="ts">
  export let title: string;
  export let eyebrow: string;
  export let description: string;
  export let icon: string = "";
</script>

<header class="workspace-intro">
  <div>
    <span>{eyebrow}</span>
    <h2>{title}</h2>
    <p>{description}</p>
  </div>
  {#if icon}<div class="workspace-intro-art"><img src={icon} alt="" /></div>{/if}
</header>

<style>
  .workspace-intro {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1.5rem;
    padding: 1.5rem 1.6rem;
    margin-bottom: 1.4rem;
    background: var(--bg-deep);
    border: 1px solid var(--border);
    border-radius: 1rem;
  }
  span {
    font-size: 0.6rem;
    letter-spacing: 0.18em;
    color: var(--accent);
    font-weight: 600;
  }
  h2 {
    font-size: 1.9rem;
    font-weight: 550;
    letter-spacing: -0.05em;
    line-height: 1.2;
    margin: 0.55rem 0;
  }
  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.83rem;
    line-height: 1.6;
  }
  .workspace-intro-art {
    width: 4rem;
    height: 4rem;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 1rem;
    display: grid;
    place-items: center;
    background: var(--bg-surface);
  }
  img {
    width: 2rem;
    height: 2rem;
    object-fit: contain;
    opacity: 0.75;
  }
  @media (max-width: 800px) {
    .workspace-intro {
      padding: 1.1rem;
    }
    h2 {
      font-size: 1.5rem;
    }
    .workspace-intro-art {
      display: none;
    }
  }
</style>
