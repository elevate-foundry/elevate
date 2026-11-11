import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { useAppStore } from '../../store';
import { valueToColor } from '../../lib/colorScales';
import { showTooltip, hideTooltip } from '../shared/Tooltip';

export function FiringRateChart() {
  const prefillData = useAppStore((s) => s.prefillData);
  const colorScale = useAppStore((s) => s.colorScale);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !prefillData) return;
    const container = containerRef.current;
    container.innerHTML = '';

    const margin = { top: 20, right: 30, bottom: 40, left: 50 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const layerRates: {
      layer: number;
      rate: number;
      min: number;
      max: number;
    }[] = [];
    prefillData.layers.forEach((layer, i) => {
      if (layer.gate?.firing_rate) {
        const rates = layer.gate.firing_rate;
        const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
        layerRates.push({
          layer: i,
          rate: avg,
          min: Math.min(...rates),
          max: Math.max(...rates),
        });
      }
    });

    if (layerRates.length > 0) {
      const x = d3
        .scaleBand()
        .domain(layerRates.map((d) => String(d.layer)))
        .range([0, width])
        .padding(0.2);
      const y = d3
        .scaleLinear()
        .domain([
          0,
          Math.min(1, (d3.max(layerRates, (d) => d.max) ?? 1) * 1.1),
        ])
        .range([height, 0]);

      svg
        .append('g')
        .selectAll('line')
        .data(y.ticks(5))
        .enter()
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', (d) => y(d))
        .attr('y2', (d) => y(d))
        .attr('stroke', '#2a2a3a')
        .attr('stroke-dasharray', '2,2');

      svg
        .selectAll('.error-bar')
        .data(layerRates)
        .enter()
        .append('line')
        .attr(
          'x1',
          (d) => (x(String(d.layer)) ?? 0) + x.bandwidth() / 2,
        )
        .attr(
          'x2',
          (d) => (x(String(d.layer)) ?? 0) + x.bandwidth() / 2,
        )
        .attr('y1', (d) => y(d.min))
        .attr('y2', (d) => y(d.max))
        .attr('stroke', '#6366f1')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.5);

      svg
        .selectAll('.bar')
        .data(layerRates)
        .enter()
        .append('rect')
        .attr('x', (d) => x(String(d.layer)) ?? 0)
        .attr('y', (d) => y(d.rate))
        .attr('width', x.bandwidth())
        .attr('height', (d) => height - y(d.rate))
        .attr('fill', (d) => valueToColor(d.rate, 0, 1, colorScale))
        .attr('rx', 2)
        .on('mouseenter', (e: MouseEvent, d) => {
          showTooltip(
            e,
            `
            <div class="tt-title">Layer ${d.layer}</div>
            <div>Avg firing: ${(d.rate * 100).toFixed(1)}%</div>
            <div>Min: ${(d.min * 100).toFixed(1)}% | Max: ${(d.max * 100).toFixed(1)}%</div>
          `,
          );
        })
        .on('mouseleave', () => hideTooltip());

      svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
          d3
            .axisBottom(x)
            .tickValues(x.domain().filter((_, i) => i % 2 === 0)),
        )
        .selectAll('text')
        .attr('fill', '#8888a0')
        .style('font-size', '10px');
      svg
        .append('g')
        .call(
          d3
            .axisLeft(y)
            .ticks(5)
            .tickFormat((d) => Number(d) * 100 + '%'),
        )
        .selectAll('text')
        .attr('fill', '#8888a0')
        .style('font-size', '10px');
      svg.selectAll('.domain, .tick line').attr('stroke', '#2a2a3a');

      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height + 35)
        .attr('text-anchor', 'middle')
        .attr('fill', '#8888a0')
        .style('font-size', '11px')
        .text('Layer');
      svg
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('fill', '#8888a0')
        .style('font-size', '11px')
        .text('Firing Rate');
    }
  }, [prefillData, colorScale]);

  if (!prefillData) {
    return (
      <>
        <div className="empty-state" id="firing-empty">
          <div className="icon">&#9881;</div>
          <div>
            Firing rate shows what fraction of neurons activate per layer
          </div>
        </div>
        <div id="firing-chart" style={{ display: 'none' }} />
      </>
    );
  }

  return (
    <>
      <div id="firing-empty" style={{ display: 'none' }} />
      <div id="firing-chart" ref={containerRef} />
    </>
  );
}
