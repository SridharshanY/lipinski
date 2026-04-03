from flask import Flask, request, jsonify
from rdkit import Chem
import os
from rdkit.Chem import Descriptors, rdMolDescriptors

app = Flask(__name__)

def lipinski(mol, identifier=None):
    try:
        smiles = Chem.MolToSmiles(mol)
    except:
        smiles = "Unknown"
        
    try:
        formula = rdMolDescriptors.CalcMolFormula(mol)
    except:
        formula = "Unknown"

    return {
        "Identifier": identifier if identifier else smiles,
        "Smiles": smiles,
        "Formula": formula,
        "MW": Descriptors.MolWt(mol),
        "LogP": Descriptors.MolLogP(mol),
        "HDonors": Descriptors.NumHDonors(mol),
        "HAcceptors": Descriptors.NumHAcceptors(mol),
        "TPSA": Descriptors.TPSA(mol),
        "RotatableBonds": Descriptors.NumRotatableBonds(mol),
        "Pass": (
            Descriptors.MolWt(mol) <= 500 and
            Descriptors.MolLogP(mol) <= 5 and
            Descriptors.NumHDonors(mol) <= 5 and
            Descriptors.NumHAcceptors(mol) <= 10
        )
    }

@app.route("/check", methods=["POST"])
def check():
    smiles = request.json.get("smiles", "")
    mol = Chem.MolFromSmiles(smiles)

    if not mol:
        return jsonify({"error": "Invalid SMILES"}), 400

    return jsonify(lipinski(mol))


@app.route("/upload", methods=["POST"])
def upload():
    files = request.files.getlist("file") or request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files uploaded"}), 400
        
    results = []
    import tempfile
    
    for file in files:
        filename = file.filename
        
        if not (filename.lower().endswith('.sdf') or filename.lower().endswith('.mol')):
            continue

        try:
            fd, temp_path = tempfile.mkstemp(suffix=".sdf")
            os.close(fd)
            
            file.save(temp_path)
            
            suppl = Chem.SDMolSupplier(temp_path)
            for i, mol in enumerate(suppl):
                if mol is not None:
                    mol_name = mol.GetProp("_Name") if mol.HasProp("_Name") else f"Molecule_{i+1}"
                    results.append(lipinski(mol, identifier=f"{filename} - {mol_name}"))
                    
            del suppl
        except Exception as e:
            print(f"Error processing {filename}: {str(e)}")
        finally:
            if 'temp_path' in locals() and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception as cleanup_err:
                    print(f"Cleanup error: {cleanup_err}")
    
    if not results and files:
        return jsonify({"error": "No supported molecules could be parsed from the uploaded file(s)."}), 400

    return jsonify(results)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
