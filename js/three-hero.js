import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

export function initHero3D(containerId = "hero3d") {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05080f, 6, 18);

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 0.4, 5.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0x5f7f9e, 0.6);
  scene.add(ambient);

  const cyanLight = new THREE.PointLight(0x00f5ff, 2.5, 20, 2);
  cyanLight.position.set(2, 2.5, 3);
  scene.add(cyanLight);

  const goldLight = new THREE.PointLight(0xd4af37, 1.4, 15, 2);
  goldLight.position.set(-3, -1.5, 2);
  scene.add(goldLight);

  const diamondGeometry = new THREE.OctahedronGeometry(1.2, 1);
  const diamondMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x88ffff,
    transmission: 0.7,
    roughness: 0.15,
    metalness: 0.35,
    emissive: 0x00e5ff,
    emissiveIntensity: 0.4,
    ior: 1.4,
    thickness: 0.8,
    clearcoat: 0.9,
    clearcoatRoughness: 0.05
  });

  const diamond = new THREE.Mesh(diamondGeometry, diamondMaterial);
  scene.add(diamond);

  const coreGlowGeometry = new THREE.SphereGeometry(0.2, 16, 16);
  const coreGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0x00f5ff,
    transparent: true,
    opacity: 0.45
  });
  const coreGlow = new THREE.Mesh(coreGlowGeometry, coreGlowMaterial);
  scene.add(coreGlow);

  const particlesCount = 420;
  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particlesCount * 3);
  const particleScales = new Float32Array(particlesCount);

  for (let i = 0; i < particlesCount; i += 1) {
    const index = i * 3;
    particlePositions[index] = (Math.random() - 0.5) * 16;
    particlePositions[index + 1] = (Math.random() - 0.5) * 9;
    particlePositions[index + 2] = (Math.random() - 0.5) * 12;
    particleScales[i] = Math.random();
  }

  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute("aScale", new THREE.BufferAttribute(particleScales, 1));

  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      color: 0x66f7ff,
      size: 0.02,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    })
  );
  scene.add(particles);

  let mouseX = 0;
  let mouseY = 0;
  let isVisible = true;

  function onPointerMove(event) {
    const bounds = container.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;

    mouseX = (x - 0.5) * 0.9;
    mouseY = (y - 0.5) * 0.9;
  }

  container.addEventListener("pointermove", onPointerMove, { passive: true });

  const observer = new IntersectionObserver(
    (entries) => {
      isVisible = entries[0]?.isIntersecting ?? true;
    },
    {
      threshold: 0.1
    }
  );
  observer.observe(container);

  function resize() {
    if (!container.clientWidth || !container.clientHeight) {
      return;
    }
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }

  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();

  function animate() {
    if (!isVisible) {
      requestAnimationFrame(animate);
      return;
    }

    const t = clock.getElapsedTime();

    diamond.rotation.x += 0.005;
    diamond.rotation.y += 0.01;
    diamond.position.y = Math.sin(t * 1.5) * 0.15;

    coreGlow.scale.setScalar(1 + Math.sin(t * 2.2) * 0.08);
    coreGlow.position.copy(diamond.position);

    particles.rotation.y = t * 0.025;

    camera.position.x += (mouseX * 1.2 - camera.position.x) * 0.05;
    camera.position.y += (-mouseY * 0.75 + 0.35 - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);

    cyanLight.position.x = 2 + Math.sin(t * 0.9) * 0.4;
    cyanLight.position.y = 2.3 + Math.cos(t * 0.8) * 0.2;

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();

  return () => {
    window.removeEventListener("resize", resize);
    container.removeEventListener("pointermove", onPointerMove);
    observer.disconnect();
    renderer.dispose();
    diamondGeometry.dispose();
    diamondMaterial.dispose();
    coreGlowGeometry.dispose();
    coreGlowMaterial.dispose();
    particleGeometry.dispose();
  };
}
