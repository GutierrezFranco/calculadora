function calculateRange() {
    var inputNumber = parseFloat(document.getElementById("inputNumber").value);
    var inputPercentage = parseFloat(document.getElementById("inputPercentage").value);
  
    var tolerance = inputNumber * (inputPercentage / 100);
    var minRange = inputNumber - tolerance;
    var maxRange = inputNumber + tolerance;
  
    document.getElementById("output").innerHTML = "Rango mínimo: " + minRange + "<br>Rango máximo: " + maxRange;
  }
  